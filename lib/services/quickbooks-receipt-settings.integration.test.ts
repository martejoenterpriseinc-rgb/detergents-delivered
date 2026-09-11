import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sealIntegration } from "@/lib/integrations/secrets";
import * as provider from "@/lib/integrations/quickbooks-client";
import { saveReceiptSettings, receiptSettingsData } from "./quickbooks-receipt-settings";
const key = "quickbooks:connection:v1:sandbox",
  config = {
    mode: "sandbox" as const,
    clientId: "synthetic",
    clientSecret: "synthetic",
    realm: "654323",
    fingerprint: "synthetic-receipt-settings",
    redirectUri: "http://localhost:3000/api/admin/quickbooks/callback",
  };
let original: Prisma.JsonValue | undefined, admin: string, cpa: string;
const users: string[] = [];
const account = (id: string) => ({
  Id: id,
  Name: id === "1" ? "Synthetic expenses" : "Synthetic bank",
  AccountType: "Bank",
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
        email: `qbo-receipt-settings-${randomUUID()}@example.test`,
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
  await prisma.setting.deleteMany({
    where: { key: "quickbooks:receipt-map:v1:sandbox:654323" },
  });
  vi.spyOn(provider, "quickbooksConfig").mockResolvedValue(config);
  vi.spyOn(provider, "readQuickbooksReceiptCompany").mockResolvedValue({
    country: "US",
    homeCurrency: "USD",
    usingSalesTax: true,
    partnerTaxEnabled: null,
  });
  vi.spyOn(provider, "readQuickbooksAccount").mockImplementation(async (_c, _t, id) =>
    account(id),
  );
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await prisma.setting.deleteMany({
    where: {
      key: {
        in: [key, "quickbooks:receipt-map:v1:sandbox:654323"],
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
  depositAccountId: "2",
  version: 0,
  confirmed: true,
});
it("saves one audited company-bound mapping across concurrent retries", async () => {
  const raw = input(),
    results = await Promise.all([
      saveReceiptSettings(admin, raw),
      saveReceiptSettings(admin, raw),
    ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({
    version: 1,
    realm: config.realm,
    depositAccount: { id: "2" },
  });
  expect(
    await prisma.auditLog.count({
      where: {
        entityId: "quickbooks:receipt-map:v1:sandbox:654323",
        actorUserId: admin,
        action: "quickbooks.receipt-settings.saved",
      },
    }),
  ).toBe(1);
  await expect(
    saveReceiptSettings(admin, { ...raw, depositAccountId: "3" }),
  ).rejects.toMatchObject({ status: 409 });
  vi.mocked(provider.quickbooksConfig).mockResolvedValue({ ...config, realm: "999" });
  await expect(saveReceiptSettings(admin, raw)).rejects.toMatchObject({ status: 409 });
});
it("enforces CPA read-only access, account types/currency and mapping version conflicts", async () => {
  await expect(saveReceiptSettings(cpa, input())).rejects.toMatchObject({
    status: 403,
  });
  expect(provider.readQuickbooksAccount).not.toHaveBeenCalled();
  vi.mocked(provider.readQuickbooksAccount).mockResolvedValueOnce({
    ...account("2"),
    CurrencyRef: { value: "EUR" },
  });
  await expect(saveReceiptSettings(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  await saveReceiptSettings(admin, input());
  await expect(saveReceiptSettings(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  const view = await receiptSettingsData(cpa);
  expect(view.canWrite).toBe(false);
  expect(view.mapping?.version).toBe(1);
});
it("rolls back an audit failure and refuses a mapping if authorization changes during provider reads", async () => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT "qbo_receipt_mapping_test" CHECK (action <> 'quickbooks.receipt-settings.saved') NOT VALID`,
  );
  try {
    await expect(saveReceiptSettings(admin, input())).rejects.toThrow();
    expect((await receiptSettingsData(admin)).mapping).toBeNull();
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT "qbo_receipt_mapping_test"',
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
    return account("2");
  });
  await expect(saveReceiptSettings(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  expect((await receiptSettingsData(admin)).mapping).toBeNull();
});
it("rejects a configuration change between initial selection and authorization", async () => {
  vi.mocked(provider.quickbooksConfig)
    .mockResolvedValueOnce(config)
    .mockResolvedValue({ ...config, fingerprint: "changed" });
  await expect(saveReceiptSettings(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  expect(provider.readQuickbooksAccount).not.toHaveBeenCalled();
});

it("refuses unsupported company country, currency, sales-tax state and non-bank accounts without saving", async () => {
  for (const change of [
    { country: "CA" },
    { homeCurrency: "CAD" },
    { usingSalesTax: false },
  ]) {
    vi.mocked(provider.readQuickbooksReceiptCompany).mockResolvedValueOnce({
      country: "US",
      homeCurrency: "USD",
      usingSalesTax: true,
      partnerTaxEnabled: null,
      ...change,
    });
    await expect(saveReceiptSettings(admin, input())).rejects.toMatchObject({
      status: 409,
    });
    expect((await receiptSettingsData(admin)).mapping).toBeNull();
  }
  for (const change of [{ AccountType: "Expense" }, { Active: false }, { Id: "wrong" }]) {
    vi.mocked(provider.readQuickbooksAccount).mockResolvedValueOnce({
      ...account("2"),
      ...change,
    });
    await expect(saveReceiptSettings(admin, input())).rejects.toMatchObject({
      status: 409,
    });
    expect((await receiptSettingsData(admin)).mapping).toBeNull();
  }
});
