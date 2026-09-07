import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  BOOTSTRAP_ADMIN_EMAIL,
  BOOTSTRAP_ADMIN_NAME,
  shouldSeedBootstrapAdmin,
} from "@/lib/domain/bootstrap-admin";

export async function hasExistingAdmin(db: PrismaClient): Promise<boolean> {
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
): Promise<"created" | "ensured" | "skipped"> {
  const existingAdmin = await hasExistingAdmin(db);
  if (
    !shouldSeedBootstrapAdmin({
      appEnv: input.appEnv,
      seedBootstrapAdmin: input.seedBootstrapFlag,
      hasExistingAdmin: existingAdmin,
    })
  ) {
    return "skipped";
  }

  const superAdmin = await db.role.findUniqueOrThrow({
    where: { code: "SUPER_ADMIN" },
  });

  const existing = await db.user.findUnique({
    where: { email: BOOTSTRAP_ADMIN_EMAIL },
  });

  if (existing) {
    if (!existing.mustChangeCredentials) {
      await db.userRole.upsert({
        where: {
          userId_roleId: { userId: existing.id, roleId: superAdmin.id },
        },
        update: {},
        create: { userId: existing.id, roleId: superAdmin.id },
      });
      return "ensured";
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    await db.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        deletedAt: null,
        mustChangeCredentials: true,
        name: existing.name ?? BOOTSTRAP_ADMIN_NAME,
      },
    });
    await db.userRole.upsert({
      where: {
        userId_roleId: { userId: existing.id, roleId: superAdmin.id },
      },
      update: {},
      create: { userId: existing.id, roleId: superAdmin.id },
    });
    return "ensured";
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await db.user.create({
    data: {
      email: BOOTSTRAP_ADMIN_EMAIL,
      name: BOOTSTRAP_ADMIN_NAME,
      passwordHash,
      mustChangeCredentials: true,
    },
  });

  await db.userRole.create({
    data: { userId: user.id, roleId: superAdmin.id },
  });

  return "created";
}
