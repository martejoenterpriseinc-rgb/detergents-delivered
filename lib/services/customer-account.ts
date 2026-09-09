import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AccountError,
  notificationSchema,
  passwordSchema,
  profileSchema,
} from "@/lib/domain/account";
import { DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD } from "@/lib/domain/credentials";

export async function accountIdentity(
  db: Prisma.TransactionClient,
  userId: string,
  lock = false,
) {
  if (lock) await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user = await db.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: { customer: true, userRoles: { include: { role: true } } },
  });
  if (!user) throw new AccountError("Please sign in again.", 401);
  if (user.mustChangeCredentials)
    throw new AccountError("Complete your required credential change first.", 403);
  return user;
}
export async function customerIdentity(
  db: Prisma.TransactionClient,
  userId: string,
  lock = false,
) {
  const user = await accountIdentity(db, userId, lock);
  if (!user.customer || user.customer.deletedAt)
    throw new AccountError("Customer profile is unavailable.", 403);
  return { user, customer: user.customer };
}
export async function getCustomerAccount(userId: string) {
  const user = await accountIdentity(prisma, userId);
  const customer = user.customer && !user.customer.deletedAt ? user.customer : null;
  return {
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    customerCreatedAt: customer?.createdAt.toISOString() ?? null,
    firstName: customer?.firstName ?? "",
    lastName: customer?.lastName ?? "",
    phone: customer?.phone ?? "",
    emailNotifications: customer?.emailNotifications ?? false,
    smsNotifications: customer?.smsNotifications ?? false,
    hasCustomer: Boolean(customer),
    hasPassword: Boolean(user.passwordHash),
  };
}
export async function updateCustomerProfile(userId: string, input: unknown) {
  const data = profileSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const { user, customer } = await customerIdentity(tx, userId, true);
    if (!data.phone && customer.smsNotifications) {
      throw new AccountError(
        "Turn off SMS notifications before removing your phone number.",
      );
    }
    // Contact changes do not modify address ownership, verification, historical orders, or roles.
    await tx.customer.update({
      where: { id: customer.id },
      data: { ...data, phone: data.phone || null },
    });
    await tx.user.update({
      where: { id: userId },
      data: { name: [data.firstName, data.lastName].filter(Boolean).join(" ") },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "customer.profile.updated",
        entityType: "Customer",
        entityId: customer.id,
        beforeJson: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
        },
        afterJson: data,
      },
    });
    return { ok: true };
  });
}
export async function updateNotifications(userId: string, input: unknown) {
  const data = notificationSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const { customer } = await customerIdentity(tx, userId, true);
    if (data.smsNotifications && !customer.phone)
      throw new AccountError("Save your phone number before enabling SMS notifications.");
    await tx.customer.update({ where: { id: customer.id }, data });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "customer.notifications.updated",
        entityType: "Customer",
        entityId: customer.id,
        beforeJson: {
          emailNotifications: customer.emailNotifications,
          smsNotifications: customer.smsNotifications,
        },
        afterJson: data,
      },
    });
    return { ok: true };
  });
}
export async function changeAccountPassword(userId: string, input: unknown) {
  const data = passwordSchema.parse(input);
  if (
    data.newPassword === DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD ||
    data.newPassword === process.env.SEED_BOOTSTRAP_ADMIN_PASSWORD
  )
    throw new AccountError("Choose a different password.");
  const result = await prisma.$transaction(
    async (tx) => {
      const user = await accountIdentity(tx, userId, true);
      if (!user.passwordHash)
        throw new AccountError("Manage your password with your sign-in provider.");
      const now = new Date();
      if (user.passwordChangeLockedUntil && user.passwordChangeLockedUntil > now)
        return { error: "Too many attempts. Try again in 15 minutes.", status: 429 };
      if (!(await bcrypt.compare(data.currentPassword, user.passwordHash))) {
        const failures = user.passwordChangeLockedUntil
          ? 1
          : user.passwordChangeFailures + 1;
        await tx.user.update({
          where: { id: userId },
          data: {
            passwordChangeFailures: failures,
            passwordChangeLockedUntil:
              failures >= 5 ? new Date(now.getTime() + 900000) : null,
          },
        });
        return { error: "Current password is incorrect.", status: 400 };
      }
      if (await bcrypt.compare(data.newPassword, user.passwordHash))
        throw new AccountError("Choose a different password.");
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: await bcrypt.hash(data.newPassword, 12),
          sessionVersion: { increment: 1 },
          passwordChangeFailures: 0,
          passwordChangeLockedUntil: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "user.password.changed",
          entityType: "User",
          entityId: userId,
          afterJson: { sessionsRevoked: true },
        },
      });
      await tx.passwordRecovery.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: now, tokenCiphertext: null },
      });
      await tx.session.deleteMany({ where: { userId } });
      return { ok: true };
    },
    { timeout: 15000 },
  );
  if (result.error) throw new AccountError(result.error, result.status);
  return { ok: true, signInRequired: true };
}
export async function getCustomerOrders(userId: string, orderId?: string) {
  const user = await accountIdentity(prisma, userId);
  if (!user.customer || user.customer.deletedAt) return [];
  return prisma.order.findMany({
    where: { customerId: user.customer.id, ...(orderId ? { id: orderId } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      number: true,
      status: true,
      createdAt: true,
      placedAt: true,
      totalCents: true,
      currency: true,
      checkoutAttempt: { select: { id: true, deliveryConfirmedAt: true } },
      items: { select: { id: true, nameSnapshot: true, quantity: true } },
      routeStops: {
        where: {
          route: { status: { notIn: ["DRAFT", "CANCELLED"] } },
          address: { customerId: user.customer.id },
        },
        orderBy: [{ route: { serviceDate: "desc" } }, { createdAt: "desc" }],
        take: 1,
        select: {
          completedAt: true,
          startedAt: true,
          arrivedAt: true,
          deliveryAttempts: {
            where: { result: "DELIVERED", order: { customerId: user.customer.id } },
            orderBy: { attemptedAt: "desc" },
            take: 1,
            select: { photos: { select: { id: true } } },
          },
          plannedArriveAt: true,
          route: { select: { serviceDate: true, status: true } },
        },
      },
    },
  });
}
