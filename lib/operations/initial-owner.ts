import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { ENVIRONMENT_KEY, validateDatabaseEnvironment } from "@/lib/database-environment";

export const INITIAL_OWNER_KEY = "system.initialProductionOwner";
export const initialOwnerInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    userId: z.string().min(1).max(100),
    approvalReference: z.string().trim().min(10).max(500),
    hostingOwnerApproval: z.string().trim().min(20).max(500).optional(),
    apply: z.boolean(),
  })
  .strict();

/**
 * Hosting-operator command only; never import into an HTTP route or startup hook.
 * The CLI validates production runtime pins before constructing this DB client.
 * Ownership is established by verified email or explicit authenticated hosting-owner
 * approval. Neither method changes inbox verification or credentials.
 */
export async function establishInitialOwner(
  db: PrismaClient,
  input: z.input<typeof initialOwnerInput>,
) {
  const data = initialOwnerInput.parse(input);
  return db.$transaction(
    async (tx) => {
      if (!data.apply) await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      if (data.apply)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${INITIAL_OWNER_KEY}, 0))`;
      const names = await tx.$queryRaw<
        { name: string }[]
      >`SELECT current_database() AS name`;
      const marker = await tx.setting.findUnique({ where: { key: ENVIRONMENT_KEY } });
      validateDatabaseEnvironment(marker?.valueJson, "production", names[0]?.name ?? "");
      if (data.apply)
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${data.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: data.userId },
        include: {
          accounts: { select: { provider: true, providerAccountId: true } },
          userRoles: { include: { role: true } },
        },
      });
      if (
        !user ||
        user.email !== data.email ||
        user.deletedAt ||
        (!user.emailVerified && !data.hostingOwnerApproval) ||
        (user.emailVerified && user.emailVerified > new Date()) ||
        user.mustChangeCredentials ||
        (!user.passwordHash &&
          !user.accounts.some(
            (account) => account.provider === "google" && account.providerAccountId,
          ))
      )
        throw new Error(
          "The exact active account needs completed credentials and verified email or explicit hosting-owner approval.",
        );
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
        )
          throw new Error(
            "First-owner setup has already been used. Use the established owner recovery process.",
          );
        return {
          status: "ALREADY_ESTABLISHED" as const,
          userId: user.id,
          email: user.email,
        };
      }
      // Include deleted staff: deletion must not reopen initial privileged onboarding.
      if (await tx.userRole.count({ where: { role: { code: { not: "CUSTOMER" } } } }))
        throw new Error(
          "A staff account already exists. Initial owner setup is unavailable.",
        );
      if (!data.apply)
        return {
          status: "READY_FOR_EXPLICIT_GRANT" as const,
          userId: user.id,
          email: user.email,
        };
      const role = await tx.role.upsert({
        where: { code: "SUPER_ADMIN" },
        update: {},
        create: { code: "SUPER_ADMIN", name: "Owner / Admin" },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      // An old customer session never inherits newly granted staff authority.
      await tx.user.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 } },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.setting.create({
        data: {
          key: INITIAL_OWNER_KEY,
          valueJson: {
            version: 1,
            userId: user.id,
            email: user.email,
            establishedAt: new Date().toISOString(),
            approvalReference: data.approvalReference,
            ownershipBasis: data.hostingOwnerApproval
              ? "authenticated-hosting-owner"
              : "verified-email",
            ...(data.hostingOwnerApproval
              ? { hostingOwnerApproval: data.hostingOwnerApproval }
              : {}),
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
            source: "explicit-hosting-operator-command",
            approvalReference: data.approvalReference,
            ownershipBasis: data.hostingOwnerApproval
              ? "authenticated-hosting-owner"
              : "verified-email",
            ...(data.hostingOwnerApproval
              ? { hostingOwnerApproval: data.hostingOwnerApproval }
              : {}),
            emailVerificationChanged: false,
            sessionsRevoked: true,
          },
        },
      });
      return { status: "ESTABLISHED" as const, userId: user.id, email: user.email };
    },
    { timeout: 15000 },
  );
}
