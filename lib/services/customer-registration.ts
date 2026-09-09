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
