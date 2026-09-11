import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sealIntegration } from "@/lib/integrations/secrets";
import * as provider from "@/lib/integrations/quickbooks-client";
import {
  saveQuickbooksMapping,
  quickbooksMappingData,
  quickbooksAccountChoices,
} from "./quickbooks-mapping";
const key = "quickbooks:connection:v1:sandbox",
  config = {
    mode: "sandbox" as const,
    clientId: "synthetic",
    clientSecret: "synthetic",
    realm: "654321",
    fingerprint: "synthetic-mapping",
    redirectUri: "http://localhost:3000/api/admin/quickbooks/callback",
  };
let original: Prisma.JsonValue | undefined,
  admin: string,
  cpa: string,
  categoryId: string;
const users: string[] = [],
  categories: string[] = [];
const account = (id: string) => ({
  Id: id,
  Name: id === "1" ? "Synthetic expenses" : "Synthetic bank",
  AccountType: id === "1" ? "Expense" : "Bank",
  Active: true,
  CurrencyRef: { value: "USD" },
});
beforeAll(async () => {
  original = (await prisma.setting.findUnique({ where: { key } }))?.valueJson;
  for (const code of ["ADMIN", "CPA"] as const) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    const user = await prisma.user.create({
      data: {
        email: `qbo-map-${randomUUID()}@example.test`,
        userRoles: { create: { roleId: role.id } },
      },
    });
    users.push(user.id);
  }
  [admin, cpa] = users;
});
beforeEach(async () => {
  const data = {
    version: 1,
    status: "CONNECTED",
    fingerprint: config.fingerprint,
    realm: config.realm,
    companyName: "Synthetic company",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    changedAt: new Date().toISOString(),
    secret: sealIntegration(
      {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        token_type: "bearer",
        expires_in: 3600,
      },
      key + ":1",
    ),
  };
  await prisma.setting.upsert({
    where: { key },
    create: { key, valueJson: data },
    update: { valueJson: data },
  });
  const category = await prisma.expenseCategory.create({
    data: { name: "synthetic-map-" + randomUUID() },
  });
  categoryId = category.id;
  categories.push(category.id);
  vi.spyOn(provider, "quickbooksConfig").mockResolvedValue(config);
  vi.spyOn(provider, "readQuickbooksAccount").mockImplementation(async (_c, _t, id) =>
    account(id),
  );
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await prisma.setting.deleteMany({
    where: {
      key: {
        in: [
          key,
          ...categories.map((id) => `quickbooks:expense-map:v1:sandbox:654321:${id}`),
        ],
      },
    },
  });
  if (original)
    await prisma.setting.create({
      data: { key, valueJson: original as Prisma.InputJsonValue },
    });
  await prisma.user.updateMany({
    where: { id: { in: users } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
const input = () => ({
  requestKey: randomUUID(),
  categoryId,
  expenseAccountId: "1",
  paymentAccountId: "2",
  version: 0,
  confirmed: true,
});
it("saves one company-bound mapping across concurrent retries and preserves the legacy unscoped field", async () => {
  const raw = input(),
    results = await Promise.all([
      saveQuickbooksMapping(admin, raw),
      saveQuickbooksMapping(admin, raw),
    ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({
    version: 1,
    realm: config.realm,
    expenseAccount: { id: "1" },
    paymentAccount: { id: "2" },
  });
  expect(
    await prisma.auditLog.count({
      where: { entityId: categoryId, action: "quickbooks.mapping.saved" },
    }),
  ).toBe(1);
  expect(
    (await prisma.expenseCategory.findUniqueOrThrow({ where: { id: categoryId } }))
      .qboAccountId,
  ).toBeNull();
  await expect(
    saveQuickbooksMapping(admin, { ...raw, paymentAccountId: "3" }),
  ).rejects.toMatchObject({ status: 409 });
  vi.mocked(provider.quickbooksConfig).mockResolvedValue({ ...config, realm: "999" });
  await expect(saveQuickbooksMapping(admin, raw)).rejects.toMatchObject({ status: 409 });
});
it("enforces CPA read-only access, account types/currency and mapping version conflicts", async () => {
  await expect(saveQuickbooksMapping(cpa, input())).rejects.toMatchObject({
    status: 403,
  });
  expect(provider.readQuickbooksAccount).not.toHaveBeenCalled();
  vi.mocked(provider.readQuickbooksAccount).mockResolvedValueOnce({
    ...account("1"),
    CurrencyRef: { value: "EUR" },
  });
  await expect(saveQuickbooksMapping(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  await saveQuickbooksMapping(admin, input());
  await expect(saveQuickbooksMapping(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  const view = await quickbooksMappingData(cpa);
  expect(view.canWrite).toBe(false);
  expect(view.categories.find((c) => c.id === categoryId)?.mapping?.version).toBe(1);
});
it("rolls back an audit failure and refuses a mapping if authorization changes during provider reads", async () => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT "qbo_mapping_test" CHECK (action <> 'quickbooks.mapping.saved') NOT VALID`,
  );
  try {
    await expect(saveQuickbooksMapping(admin, input())).rejects.toThrow();
    expect(
      (await quickbooksMappingData(admin)).categories.find((c) => c.id === categoryId)
        ?.mapping,
    ).toBeNull();
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT "qbo_mapping_test"',
    );
  }
  vi.mocked(provider.readQuickbooksAccount).mockImplementationOnce(async () => {
    const row = await prisma.setting.findUniqueOrThrow({ where: { key } });
    await prisma.setting.update({
      where: { key },
      data: {
        valueJson: {
          ...(row.valueJson as Prisma.JsonObject),
          version: 2,
          status: "DISCONNECTED",
          secret: null,
        },
      },
    });
    return account("1");
  });
  await expect(saveQuickbooksMapping(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  expect(
    (await quickbooksMappingData(admin)).categories.find((c) => c.id === categoryId)
      ?.mapping,
  ).toBeNull();
});
it("lists accounts for the authorized company with a bounded cursor and no token disclosure", async () => {
  vi.spyOn(provider, "readQuickbooksAccounts").mockResolvedValue({
    accounts: [account("1")],
    nextStart: null,
  });
  const result = await quickbooksAccountChoices(cpa, { start: 1 });
  expect(result.realm).toBe(config.realm);
  expect(JSON.stringify(result)).not.toContain("synthetic-access");
  await expect(quickbooksAccountChoices(cpa, { start: 0 })).rejects.toThrow();
});
