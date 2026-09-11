import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import * as provider from "@/lib/integrations/quickbooks-client";
import {
  beginQuickbooksConnection,
  completeQuickbooksConnection,
  maintainQuickbooksConnection,
  quickbooksConnectionStatus,
} from "./quickbooks-connection";
const key = "quickbooks:connection:v1:sandbox";
const ids: string[] = [];
let admin: string, other: string, cpa: string;
const config = {
  mode: "sandbox" as const,
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
  realm: "123456",
  redirectUri: "http://localhost:3000/api/admin/quickbooks/callback",
  fingerprint: "synthetic-fingerprint",
};
const tokens = () => ({
  access_token: "synthetic-access-" + randomUUID(),
  refresh_token: "synthetic-refresh-" + randomUUID(),
  token_type: "bearer",
  expires_in: 3600,
});
let original: Prisma.JsonValue | undefined;
beforeAll(async () => {
  original = (await prisma.setting.findUnique({ where: { key } }))?.valueJson;
  for (const code of ["ADMIN", "ADMIN", "CPA"] as const) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    const user = await prisma.user.create({
      data: {
        email: `qbo-${randomUUID()}@example.test`,
        emailVerified: new Date(),
        userRoles: { create: { roleId: role.id } },
      },
    });
    ids.push(user.id);
  }
  [admin, other, cpa] = ids;
});
beforeEach(async () => {
  await prisma.setting.deleteMany({ where: { key } });
  vi.spyOn(provider, "quickbooksConfig").mockResolvedValue(config);
  vi.spyOn(provider, "verifyQuickbooksCompany").mockResolvedValue("Synthetic company");
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key } });
  if (original)
    await prisma.setting.create({
      data: { key, valueJson: original as Prisma.InputJsonValue },
    });
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
async function callback(actor = admin) {
  const { authorizationUrl } = await beginQuickbooksConnection(actor);
  return {
    state: new URL(authorizationUrl).searchParams.get("state")!,
    code: "synthetic-code",
    realmId: config.realm,
  };
}
async function expire() {
  const row = await prisma.setting.findUniqueOrThrow({ where: { key } });
  await prisma.setting.update({
    where: { key },
    data: {
      valueJson: {
        ...(row.valueJson as Prisma.JsonObject),
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    },
  });
}
it("binds callback to administrator and intended company, consumes once, and stores only encrypted tokens", async () => {
  const token = tokens(),
    exchange = vi.spyOn(provider, "exchangeQuickbooksToken").mockResolvedValue(token),
    input = await callback();
  await expect(beginQuickbooksConnection(cpa)).rejects.toMatchObject({ status: 403 });
  await expect(completeQuickbooksConnection(other, input)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    completeQuickbooksConnection(admin, { ...input, realmId: "999" }),
  ).rejects.toMatchObject({ status: 409 });
  const results = await Promise.allSettled([
    completeQuickbooksConnection(admin, input),
    completeQuickbooksConnection(admin, input),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(exchange).toHaveBeenCalledTimes(1);
  const row = await prisma.setting.findUniqueOrThrow({ where: { key } }),
    status = await quickbooksConnectionStatus(cpa);
  expect(status).toMatchObject({
    usable: true,
    canWrite: false,
    postingEnabled: false,
    companyName: "Synthetic company",
  });
  const evidence = JSON.stringify({
    row,
    status,
    audit: await prisma.auditLog.findMany({ where: { entityId: key } }),
  });
  expect(evidence).not.toContain(token.access_token);
  expect(evidence).not.toContain(token.refresh_token);
  expect(evidence).not.toContain(input.state);
  vi.mocked(provider.quickbooksConfig).mockResolvedValue({
    ...config,
    fingerprint: "changed",
  });
  expect((await quickbooksConnectionStatus(admin)).usable).toBe(false);
});
it("invalidates rotated sessions and prevents callback replay after exchange or audit failure", async () => {
  const input = await callback(other),
    exchange = vi
      .spyOn(provider, "exchangeQuickbooksToken")
      .mockRejectedValue(new Error("synthetic provider failure"));
  await prisma.user.update({
    where: { id: other },
    data: { sessionVersion: { increment: 1 } },
  });
  await expect(completeQuickbooksConnection(other, input)).rejects.toMatchObject({
    status: 409,
  });
  expect(exchange).not.toHaveBeenCalled();
  const retry = await callback(other);
  await expect(completeQuickbooksConnection(other, retry)).rejects.toThrow();
  await expect(completeQuickbooksConnection(other, retry)).rejects.toMatchObject({
    status: 409,
  });
  expect(exchange).toHaveBeenCalledTimes(1);
  exchange.mockResolvedValue(tokens());
  const audited = await callback(other);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT "qbo_test_audit" CHECK (action <> 'quickbooks.connected') NOT VALID`,
  );
  try {
    await expect(completeQuickbooksConnection(other, audited)).rejects.toThrow();
    expect(await prisma.setting.findUnique({ where: { key } })).toBeNull();
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT "qbo_test_audit"',
    );
  }
});
it("serializes refresh and blocks uncertain refreshes instead of replaying rotated tokens", async () => {
  const exchange = vi
    .spyOn(provider, "exchangeQuickbooksToken")
    .mockResolvedValue(tokens());
  await completeQuickbooksConnection(admin, await callback());
  await expire();
  const rotated = tokens();
  let release!: (value: ReturnType<typeof tokens>) => void;
  exchange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = maintainQuickbooksConnection(admin, "refresh");
  await vi.waitFor(() => expect(release).toBeDefined());
  await expect(maintainQuickbooksConnection(admin, "refresh")).rejects.toMatchObject({
    status: 409,
  });
  release(rotated);
  await first;
  expect(exchange).toHaveBeenCalledTimes(2);
  expect((await quickbooksConnectionStatus(admin)).usable).toBe(true);
  await expire();
  exchange.mockRejectedValueOnce(new Error("synthetic lost response"));
  await expect(maintainQuickbooksConnection(admin, "refresh")).rejects.toMatchObject({
    status: 503,
  });
  await expect(maintainQuickbooksConnection(admin, "refresh")).rejects.toMatchObject({
    status: 409,
  });
  expect((await quickbooksConnectionStatus(admin)).status).toBe("RECONNECT");
  expect(exchange).toHaveBeenCalledTimes(3);
});
it("blocks access immediately on an uncertain disconnect and permits a bounded revoke retry", async () => {
  vi.spyOn(provider, "exchangeQuickbooksToken").mockResolvedValue(tokens());
  await completeQuickbooksConnection(admin, await callback());
  const revoke = vi
    .spyOn(provider, "revokeQuickbooksToken")
    .mockRejectedValueOnce(new Error("synthetic timeout"))
    .mockResolvedValue(undefined);
  await expect(maintainQuickbooksConnection(admin, "disconnect")).rejects.toMatchObject({
    status: 503,
  });
  expect(await quickbooksConnectionStatus(admin)).toMatchObject({
    usable: false,
    status: "DISCONNECTING",
  });
  await expect(beginQuickbooksConnection(admin)).rejects.toMatchObject({ status: 409 });
  await expect(maintainQuickbooksConnection(admin, "disconnect")).rejects.toMatchObject({
    status: 409,
  });
  const row = await prisma.setting.findUniqueOrThrow({ where: { key } });
  await prisma.setting.update({
    where: { key },
    data: {
      valueJson: {
        ...(row.valueJson as Prisma.JsonObject),
        changedAt: "2020-01-01T00:00:00.000Z",
      },
    },
  });
  await maintainQuickbooksConnection(admin, "disconnect");
  await maintainQuickbooksConnection(admin, "disconnect");
  expect(revoke).toHaveBeenCalledTimes(2);
  expect(
    (await prisma.setting.findUniqueOrThrow({ where: { key } })).valueJson,
  ).toMatchObject({ status: "DISCONNECTED", secret: null });
});
