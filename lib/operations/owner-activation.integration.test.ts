import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import "@/tests/integration-guard";
import { activateInitialOwner } from "./owner-activation";
import { ENVIRONMENT_KEY } from "@/lib/database-environment";

const schema = `dd_owner_activation_${randomUUID().replaceAll("-", "")}`;
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set("schema", schema);
const control = new PrismaClient({ log: [] });
const db = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
const email = "joedy.martell@gmail.com";
const token = "owner-activation-token-for-isolated-ci-2026";
let userId: string;

beforeAll(async () => {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "pipe",
    timeout: 45000,
  });
}, 60000);

beforeEach(async () => {
  process.env.DD_INITIAL_OWNER_EMAIL = email;
  process.env.DD_INITIAL_OWNER_TOKEN = token;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "${schema}"."User", "${schema}"."Setting", "${schema}"."Role", "${schema}"."AuditLog" RESTART IDENTITY CASCADE`,
  );
  await db.setting.create({
    data: {
      key: ENVIRONMENT_KEY,
      valueJson: {
        project: "detergents-delivered",
        environment: "production",
        databaseName: "detergents_delivered_ci",
      },
    },
  });
  const role = await db.role.create({ data: { code: "CUSTOMER", name: "Customer" } });
  const user = await db.user.create({
    data: {
      email,
      passwordHash: "synthetic-password-hash",
      userRoles: { create: { roleId: role.id } },
      sessions: { create: { sessionToken: randomUUID(), expires: new Date("2099-01-01") } },
    },
  });
  userId = user.id;
});

afterAll(async () => {
  delete process.env.DD_INITIAL_OWNER_EMAIL;
  delete process.env.DD_INITIAL_OWNER_TOKEN;
  await db.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
});

describe("authenticated first-owner activation", () => {
  it("adds SUPER_ADMIN without removing CUSTOMER and revokes old sessions", async () => {
    await expect(
      activateInitialOwner(db, { activationToken: token }, userId, email),
    ).resolves.toMatchObject({ status: "ESTABLISHED", userId, email });
    expect(await db.userRole.count({ where: { userId } })).toBe(2);
    expect(await db.userRole.count({ where: { userId, role: { code: "CUSTOMER" } } })).toBe(1);
    expect(await db.userRole.count({ where: { userId, role: { code: "SUPER_ADMIN" } } })).toBe(1);
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await db.setting.findUnique({ where: { key: "system.initialProductionOwner" } })).not.toBeNull();
  });

  it("rejects a wrong token and a different email without writing", async () => {
    await expect(
      activateInitialOwner(db, { activationToken: "wrong-owner-activation-token-2026" }, userId, email),
    ).rejects.toThrow("invalid");
    await expect(
      activateInitialOwner(db, { activationToken: token }, userId, "someone-else@example.com"),
    ).rejects.toThrow("not available");
    expect(await db.userRole.count({ where: { userId, role: { code: "SUPER_ADMIN" } } })).toBe(0);
  });

  it("does not grant another account after the first-owner marker exists", async () => {
    await activateInitialOwner(db, { activationToken: token }, userId, email);
    const other = await db.user.create({
      data: {
        email: "other@example.com",
        passwordHash: "synthetic",
        userRoles: { create: { role: { create: { code: "CUSTOMER", name: "Customer 2" } } } },
      },
    });
    await expect(
      activateInitialOwner(db, { activationToken: token }, other.id, other.email),
    ).rejects.toThrow("not available");
  });
});
