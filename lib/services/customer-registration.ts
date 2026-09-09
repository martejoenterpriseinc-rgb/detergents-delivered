import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { accountEmailSchema, registerAccountSchema } from "@/lib/domain/customer-access";
import { DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD } from "@/lib/domain/credentials";

export function rejectTemporaryPassword(password: string) {
  if (
    password === DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD ||
    password === process.env.SEED_BOOTSTRAP_ADMIN_PASSWORD
  )
    throw new AccountError("Choose a different password.");
}

// All self-service paths use this transaction. No client-supplied roles, approval,
// addresses, payment records, or marketing consents are accepted.
export async function createHouseholdUser(input: {
  email: string;
  name?: string | null;
  image?: string | null;
  passwordHash?: string;
  emailVerified?: Date | null;
}) {
  const email = accountEmailSchema.parse(input.email);
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.upsert({
      where: { code: "CUSTOMER" },
      update: {},
      create: { code: "CUSTOMER", name: "Customer" },
    });
    const name = input.name?.trim().slice(0, 120) || null;
    const user = await tx.user.create({
      data: {
        email,
        name,
        image: input.image ?? null,
        emailVerified: input.emailVerified ?? null,
        passwordHash: input.passwordHash ?? null,
        userRoles: { create: { roleId: role.id } },
        customer: {
          create: {
            firstName: name?.split(" ")[0] ?? null,
            lastName: name?.split(" ").slice(1).join(" ") || null,
          },
        },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "user.registered",
        entityType: "User",
        entityId: user.id,
        afterJson: {
          role: "CUSTOMER",
          method: input.passwordHash ? "credentials" : "google",
        },
      },
    });
    return user;
  });
}

export async function registerCustomer(input: unknown) {
  const data = registerAccountSchema.parse(input);
  rejectTemporaryPassword(data.password);
  return createHouseholdUser({
    email: data.email,
    name: data.name,
    passwordHash: await bcrypt.hash(data.password, 12),
  });
}

// Older Google logins used the generic adapter and could lack a household/role.
// Repair only that incomplete customer identity after Auth.js verifies Google.
// Staff identities and suspended households are never promoted or reactivated.
export async function ensureGoogleHousehold(userId: string, verifiedEmail: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { customer: true, userRoles: { include: { role: true } } },
    });
    if (!user || user.deletedAt || user.customer?.deletedAt) return false;
    if (user.userRoles.some((row) => row.role.code !== "CUSTOMER")) return true;
    let changed = false;
    if (!user.userRoles.length) {
      const role = await tx.role.upsert({
        where: { code: "CUSTOMER" },
        update: {},
        create: { code: "CUSTOMER", name: "Customer" },
      });
      await tx.userRole.create({ data: { userId, roleId: role.id } });
      changed = true;
    }
    if (!user.customer) {
      await tx.customer.create({
        data: {
          userId,
          firstName: user.name?.split(" ")[0] || null,
          lastName: user.name?.split(" ").slice(1).join(" ") || null,
        },
      });
      changed = true;
    }
    if (!user.emailVerified && user.email === verifiedEmail.trim().toLowerCase()) {
      await tx.user.update({
        where: { id: userId },
        data: { emailVerified: new Date() },
      });
      changed = true;
    }
    if (changed)
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "user.google.household.completed",
          entityType: "User",
          entityId: userId,
          afterJson: { role: "CUSTOMER" },
        },
      });
    return true;
  });
}
