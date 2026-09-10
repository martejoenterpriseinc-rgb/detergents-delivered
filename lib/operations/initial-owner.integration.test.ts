import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import "@/tests/integration-guard";
import { establishInitialOwner, INITIAL_OWNER_KEY } from "./initial-owner";
import { ENVIRONMENT_KEY } from "@/lib/database-environment";

// A new schema inside the guarded loopback CI database keeps the first-owner
// invariant independent of staff fixtures retained by all other integration tests.
const schema = `dd_owner_${randomUUID().replaceAll("-", "")}`;
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set("schema", schema);
const control = new PrismaClient({ log: [] });
const db = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
const email = "synthetic-owner@example.test";
const approvalReference = "Synthetic isolated CI ownership approval";
let userId: string;
beforeAll(async () => {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  try {
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: "pipe",
        timeout: 45000,
      },
    );
  } catch {
    throw new Error("Isolated first-owner test schema initialization failed.");
  }
}, 60000);
beforeEach(async () => {
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
      emailVerified: new Date("2026-01-01T00:00:00Z"),
      accounts: {
        create: { provider: "google", type: "oauth", providerAccountId: randomUUID() },
      },
      userRoles: { create: { roleId: role.id } },
      sessions: {
        create: { sessionToken: randomUUID(), expires: new Date("2099-01-01") },
      },
    },
  });
  userId = user.id;
});
afterAll(async () => {
  await db.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
});
const input = (apply = true) => ({ userId, email, approvalReference, apply });

describe("explicit first production owner (isolated PostgreSQL schema)", () => {
  it("reviews without writes, grants once, preserves identity and revokes old sessions", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await establishInitialOwner(db, input(false))).toMatchObject({
      status: "READY_FOR_EXPLICIT_GRANT",
    });
    expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(before);
    expect(await db.setting.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(0);
    expect(await establishInitialOwner(db, input())).toMatchObject({
      status: "ESTABLISHED",
      userId,
      email,
    });
    expect(await establishInitialOwner(db, input())).toMatchObject({
      status: "ALREADY_ESTABLISHED",
    });
    expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
      email,
      emailVerified: before.emailVerified,
      passwordHash: before.passwordHash,
      sessionVersion: 1,
      mustChangeCredentials: false,
    });
    expect(await db.session.count()).toBe(0);
    expect(await db.userRole.count({ where: { role: { code: "SUPER_ADMIN" } } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: "production.initial-owner.established" },
      }),
    ).toBe(1);
  });
  it("requires retained production identity and an exact verified active account", async () => {
    await expect(
      establishInitialOwner(db, { ...input(), email: "other@example.test" }),
    ).rejects.toThrow();
    await expect(
      establishInitialOwner(db, { ...input(), userId: "missing" }),
    ).rejects.toThrow();
    for (const patch of [
      { emailVerified: null },
      { deletedAt: new Date() },
      { mustChangeCredentials: true },
    ]) {
      await db.user.update({ where: { id: userId }, data: patch });
      await expect(establishInitialOwner(db, input())).rejects.toThrow();
      await db.user.update({
        where: { id: userId },
        data: {
          emailVerified: new Date("2026-01-01"),
          deletedAt: null,
          mustChangeCredentials: false,
        },
      });
    }
    await db.setting.update({
      where: { key: ENVIRONMENT_KEY },
      data: {
        valueJson: {
          project: "detergents-delivered",
          environment: "staging",
          databaseName: "detergents_delivered_ci",
        },
      },
    });
    await expect(establishInitialOwner(db, input())).rejects.toThrow();
    expect(await db.userRole.count({ where: { role: { code: "SUPER_ADMIN" } } })).toBe(0);
  });
  it("refuses setup when any staff identity already exists, including a deleted one", async () => {
    await db.user.create({
      data: {
        email: "deleted-staff@example.test",
        deletedAt: new Date(),
        userRoles: { create: { role: { create: { code: "CPA", name: "CPA" } } } },
      },
    });
    await expect(establishInitialOwner(db, input())).rejects.toThrow(
      "staff account already exists",
    );
    expect(await db.setting.findUnique({ where: { key: INITIAL_OWNER_KEY } })).toBeNull();
  });
  it("rolls back the role, session revocation and setup marker if audit storage fails", async () => {
    await db.$executeRawUnsafe(
      `ALTER TABLE "${schema}"."AuditLog" ADD CONSTRAINT owner_audit_test CHECK (action <> 'production.initial-owner.established') NOT VALID`,
    );
    try {
      await expect(establishInitialOwner(db, input())).rejects.toThrow();
      expect(await db.userRole.count({ where: { role: { code: "SUPER_ADMIN" } } })).toBe(
        0,
      );
      expect(
        await db.setting.findUnique({ where: { key: INITIAL_OWNER_KEY } }),
      ).toBeNull();
      expect(await db.session.count()).toBe(1);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion,
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `ALTER TABLE "${schema}"."AuditLog" DROP CONSTRAINT owner_audit_test`,
      );
    }
  });
  it("serializes competing grants and never re-grants explicitly revoked owner authority", async () => {
    const second = await db.user.create({
      data: {
        email: "second-owner@example.test",
        emailVerified: new Date("2026-01-01"),
        accounts: {
          create: { provider: "google", type: "oauth", providerAccountId: randomUUID() },
        },
      },
    });
    const secondInput = { ...input(), email: second.email, userId: second.id };
    const results = await Promise.allSettled([
      establishInitialOwner(db, input()),
      establishInitialOwner(db, secondInput),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const granted = await db.userRole.findFirstOrThrow({
      where: { role: { code: "SUPER_ADMIN" } },
    });
    const selected = granted.userId === userId ? input() : secondInput;
    await db.userRole.delete({
      where: { userId_roleId: { userId: granted.userId, roleId: granted.roleId } },
    });
    await expect(establishInitialOwner(db, selected)).rejects.toThrow(
      "already been used",
    );
    expect(await db.userRole.count({ where: { role: { code: "SUPER_ADMIN" } } })).toBe(0);
  });
});
