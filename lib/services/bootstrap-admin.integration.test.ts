import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BOOTSTRAP_ADMIN_EMAIL } from "@/lib/domain/bootstrap-admin";
import { ensureBootstrapAdmin, hasExistingAdmin } from "./bootstrap-admin";

const suffix = randomUUID().slice(0, 8);

async function ensureRoles() {
  await prisma.role.upsert({
    where: { code: "SUPER_ADMIN" },
    update: {},
    create: {
      code: "SUPER_ADMIN",
      name: "Super admin",
      description: "test",
    },
  });
  await prisma.role.upsert({
    where: { code: "ADMIN" },
    update: {},
    create: { code: "ADMIN", name: "Admin", description: "test" },
  });
}

async function deleteBootstrapEmailUser() {
  const existing = await prisma.user.findUnique({
    where: { email: BOOTSTRAP_ADMIN_EMAIL },
  });
  if (!existing) return;
  await prisma.userRole.deleteMany({ where: { userId: existing.id } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: existing.id } });
  await prisma.user.delete({ where: { id: existing.id } });
}

describe("ensureBootstrapAdmin", () => {
  beforeAll(async () => {
    await ensureRoles();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a SUPER_ADMIN with mustChangeCredentials when the flag is set", async () => {
    await deleteBootstrapEmailUser();

    const created = await ensureBootstrapAdmin(prisma, {
      appEnv: "development",
      seedBootstrapFlag: true,
      password: `Temp-${suffix}-password`,
    });
    expect(created).toBe("created");

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: BOOTSTRAP_ADMIN_EMAIL },
      include: { userRoles: { include: { role: true } } },
    });
    expect(user.mustChangeCredentials).toBe(true);
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toBe(`Temp-${suffix}-password`);
    expect(await bcrypt.compare(`Temp-${suffix}-password`, user.passwordHash!)).toBe(
      true,
    );
    expect(user.userRoles.some((row) => row.role.code === "SUPER_ADMIN")).toBe(true);
  });

  it("does not reset a bootstrap user who already changed credentials", async () => {
    let user = await prisma.user.findUnique({
      where: { email: BOOTSTRAP_ADMIN_EMAIL },
    });
    if (!user) {
      await ensureBootstrapAdmin(prisma, {
        appEnv: "staging",
        seedBootstrapFlag: true,
        password: `Temp-${suffix}-password`,
      });
      user = await prisma.user.findUniqueOrThrow({
        where: { email: BOOTSTRAP_ADMIN_EMAIL },
      });
    }

    const rotatedHash = await bcrypt.hash("Already-Changed-Now!", 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email: `rotated-${suffix}@detergentsdelivered.com`,
        passwordHash: rotatedHash,
        mustChangeCredentials: false,
      },
    });

    const result = await ensureBootstrapAdmin(prisma, {
      appEnv: "staging",
      seedBootstrapFlag: true,
      password: "Should-Not-Apply-This!",
    });
    expect(["created", "ensured", "skipped"]).toContain(result);

    const rotated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(rotated.mustChangeCredentials).toBe(false);
    expect(await bcrypt.compare("Already-Changed-Now!", rotated.passwordHash!)).toBe(
      true,
    );
  });

  it("skips production even when the flag is set", async () => {
    const result = await ensureBootstrapAdmin(prisma, {
      appEnv: "production",
      seedBootstrapFlag: true,
      password: "Should-Not-Create!",
    });
    expect(result).toBe("skipped");
  });

  it("reports existing admins", async () => {
    expect(await hasExistingAdmin(prisma)).toBe(true);
  });
});
