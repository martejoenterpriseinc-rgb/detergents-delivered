import "@/tests/integration-guard";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordCheckpoint, compareRecordCheckpoints } from "./database-record-checkpoint";

afterAll(async () => {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "SyntheticRecordCheckpoint"');
  await prisma.$disconnect();
});
it("verifies retained columns across an additive change and detects edits and deletes without exposing rows", async () => {
  await prisma.$executeRawUnsafe(
    'CREATE TABLE "SyntheticRecordCheckpoint" ("id" TEXT PRIMARY KEY, "privateValue" TEXT NOT NULL)',
  );
  const secret = randomUUID();
  await prisma.$executeRaw`INSERT INTO "SyntheticRecordCheckpoint" VALUES ('b', ${secret}), ('a', 'synthetic')`;
  const identity = {
    environment: "development",
    databaseHash: createHash("sha256").update("synthetic-only").digest("hex"),
  };
  const before = await recordCheckpoint(prisma, identity);
  expect(JSON.stringify(before)).not.toContain(secret);
  expect(before.tables.find((t) => t.name === "SyntheticRecordCheckpoint")?.count).toBe(
    2,
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "SyntheticRecordCheckpoint" ADD COLUMN "added" INTEGER DEFAULT 7',
  );
  const after = await recordCheckpoint(prisma, identity, before);
  expect(compareRecordCheckpoints(before, after)).toEqual([]);
  await prisma.$executeRaw`UPDATE "SyntheticRecordCheckpoint" SET "privateValue"='changed' WHERE id='b'`;
  expect(
    compareRecordCheckpoints(before, await recordCheckpoint(prisma, identity, before)),
  ).toEqual(["SyntheticRecordCheckpoint"]);
  await prisma.$executeRaw`DELETE FROM "SyntheticRecordCheckpoint" WHERE id='a'`;
  const deleted = await recordCheckpoint(prisma, identity, before);
  expect(deleted.tables.find((t) => t.name === "SyntheticRecordCheckpoint")?.count).toBe(
    1,
  );
  expect(compareRecordCheckpoints(before, deleted)).toEqual([
    "SyntheticRecordCheckpoint",
  ]);
  await expect(
    recordCheckpoint(prisma, { ...identity, environment: "production" }, before),
  ).rejects.toThrow("different database");
  const invalid = structuredClone(before);
  invalid.tables
    .find((t) => t.name === "SyntheticRecordCheckpoint")!
    .columns.push('missing";DROP TABLE "User";--');
  await expect(recordCheckpoint(prisma, identity, invalid)).rejects.toThrow(
    "missing or changed",
  );
  expect(await prisma.user.count()).toBeGreaterThanOrEqual(0);
});
