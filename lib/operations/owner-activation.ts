import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { ENVIRONMENT_KEY, validateDatabaseEnvironment } from "@/lib/database-environment";
import { INITIAL_OWNER_KEY } from "@/lib/operations/initial-owner";

export const ownerActivationInput = z
  .object({ activationToken: z.string().min(20).max(200) })
  .strict();

function tokensEqual(expected: string, supplied: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Authenticated, one-time production owner activation. This is deliberately
 * narrower than general role management: the configured email, one-time token,
 * retained production database identity, first-owner marker, and staff-account
 * guard must all agree before any privileged role is written.
 */
export async function activateInitialOwner(
  db: PrismaClient,
  input: z.input<typeof ownerActivationInput>,
  userId: string,
  email: string,
) {
  const data = ownerActivationInput.parse(input);
  const configuredEmail = process.env.DD_INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  const configuredToken = process.env.DD_INITIAL_OWNER_TOKEN ?? "";
  const normalizedEmail = email.trim().toLowerCase();
  if (!configuredEmail || !configuredToken || normalizedEmail !== configuredEmail) {
    throw new Error("Initial owner activation is not available for this account.");
  }
  if (!tokensEqual(configuredToken, data.activationToken)) {
    throw new Error("The owner activation code is invalid.");
  }

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${INITIAL_OWNER_KEY}, 0))`;
      const names = await tx.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
      const marker = await tx.setting.findUnique({ where: { key: ENVIRONMENT_KEY } });
      validateDatabaseEnvironment(marker?.valueJson, "production", names[0]?.name ?? "");
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          accounts: { select: { provider: true, providerAccountId: true } },
          userRoles: { include: { role: true } },
        },
      });
      if (
        !user ||
        user.email !== normalizedEmail ||
        user.deletedAt ||
        user.mustChangeCredentials ||
        (!user.passwordHash &&
          !user.accounts.some(
            (account) => account.provider === "google" && account.providerAccountId,
          ))
      ) {
        throw new Error(
          "The exact active production customer account is not eligible for owner activation.",
        );
      }

      const prior = await tx.setting.findUnique({ where: { key: INITIAL_OWNER_KEY } });
      if (prior) {
        const record = z
          .object({ userId: z.string(), email: z.string() })
          .passthrough()
          .safeParse(prior.valueJson);
        if (
          !record.success ||
          record.data.userId !== user.id ||
          record.data.email !== user.email ||
          !user.userRoles.some(({ role }) => role.code === "SUPER_ADMIN")
        ) {
          throw new Error("First-owner setup has already been used.");
        }
        return { status: "ALREADY_ESTABLISHED" as const, userId: user.id, email: user.email };
      }

      if (await tx.userRole.count({ where: { role: { code: { not: "CUSTOMER" } } } })) {
        throw new Error("A staff account already exists. Initial owner activation is unavailable.");
      }

      const role = await tx.role.upsert({
        where: { code: "SUPER_ADMIN" },
        update: {},
        create: { code: "SUPER_ADMIN", name: "Owner / Admin" },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      await tx.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.setting.create({
        data: {
          key: INITIAL_OWNER_KEY,
          valueJson: {
            version: 1,
            userId: user.id,
            email: user.email,
            establishedAt: new Date().toISOString(),
            source: "authenticated-owner-activation-token",
          },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "production.initial-owner.established",
          entityType: "User",
          entityId: user.id,
          beforeJson: { roles: user.userRoles.map(({ role }) => role.code) },
          afterJson: {
            role: "SUPER_ADMIN",
            source: "authenticated-owner-activation-token",
            sessionsRevoked: true,
          },
        },
      });
      return { status: "ESTABLISHED" as const, userId: user.id, email: user.email };
    },
    { timeout: 15000 },
  );
}
