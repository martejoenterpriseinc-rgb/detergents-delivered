import type { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  BOOTSTRAP_ADMIN_EMAIL,
  BOOTSTRAP_ADMIN_NAME,
  shouldSeedBootstrapAdmin,
  resolveBootstrapPassword,
} from "@/lib/domain/bootstrap-admin";

export async function hasExistingAdmin(db: Prisma.TransactionClient): Promise<boolean> {
  const row = await db.userRole.findFirst({
    where: {
      role: { code: { in: ["ADMIN", "SUPER_ADMIN"] } },
      user: { deletedAt: null },
    },
    select: { userId: true },
  });
  return Boolean(row);
}

export async function ensureBootstrapAdmin(
  db: PrismaClient,
  input: {
    appEnv: string;
    seedBootstrapFlag: boolean;
    password: string;
  },
): Promise<"created" | "skipped"> {
  if (
    !shouldSeedBootstrapAdmin({
      appEnv: input.appEnv,
      seedBootstrapAdmin: input.seedBootstrapFlag,
      hasExistingAdmin: false,
    })
  ) {
    return "skipped";
  }

  const { password } = resolveBootstrapPassword(input.password);
  const passwordHash = await bcrypt.hash(password, 12);
  return db.$transaction(async (tx) => {
    // Serialize two setup commands. No account/role write can escape this transaction.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('detergents-delivered-bootstrap-admin'))`;
    if (await hasExistingAdmin(tx)) return "skipped";
    const superAdmin = await tx.role.findUniqueOrThrow({
      where: { code: "SUPER_ADMIN" },
    });

    const existing = await tx.user.findUnique({
      where: { email: BOOTSTRAP_ADMIN_EMAIL },
    });

    if (existing) {
      throw new Error(
        "Bootstrap address already exists; use account recovery. No password, role, or deletion state was changed.",
      );
    }

    const user = await tx.user.create({
      data: {
        email: BOOTSTRAP_ADMIN_EMAIL,
        name: BOOTSTRAP_ADMIN_NAME,
        passwordHash,
        mustChangeCredentials: true,
      },
    });

    await tx.userRole.create({
      data: { userId: user.id, roleId: superAdmin.id },
    });

    return "created";
  });
}
