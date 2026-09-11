import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sealIntegration } from "@/lib/integrations/secrets";
import * as provider from "@/lib/integrations/quickbooks-client";
import { saveSalesMapping, salesMappingSources } from "./quickbooks-sales-mapping";
const key = "quickbooks:connection:v1:sandbox",
  config = {
    mode: "sandbox" as const,
    clientId: "synthetic",
    clientSecret: "synthetic",
    realm: "654323",
    fingerprint: "synthetic-sales-mapping",
    redirectUri: "http://localhost:3000/api/admin/quickbooks/callback",
  };
let original: Prisma.JsonValue | undefined,
  admin: string,
  cpa: string,
  sourceId: string,
  externalId: string;
const users: string[] = [];
const account = (id: string) => ({
  kind: "customer" as const,
  id,
  name: "Synthetic customer",
  active: true,
  currency: "USD",
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
  externalId = String(BigInt("0x" + randomUUID().replaceAll("-", "").slice(0, 16)));
  sourceId = (
    await prisma.customer.create({
      data: {
        user: {
          create: { email: "synthetic-qbo-customer-" + randomUUID() + "@example.test" },
        },
        firstName: "Synthetic",
      },
    })
  ).id;

  vi.spyOn(provider, "quickbooksConfig").mockResolvedValue(config);
  vi.spyOn(provider, "readQuickbooksSalesEntity").mockImplementation(
    async (_c, _t, _kind, id) => account(id),
  );
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await prisma.setting.deleteMany({
    where: {
      OR: [{ key }, { key: { startsWith: "quickbooks:sales-map:v1:sandbox:654323:" } }],
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
  kind: "customer",
  sourceId,
  externalId: externalId,
  version: 0,
  confirmed: true,
});
it("saves one audited company-bound mapping across concurrent retries", async () => {
  const raw = input(),
    results = await Promise.all([
      saveSalesMapping(admin, raw),
      saveSalesMapping(admin, raw),
    ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({
    version: 1,
    realm: config.realm,
    sourceId,
    externalId: raw.externalId,
  });
  expect(
    await prisma.auditLog.count({
      where: {
        entityId: `quickbooks:sales-map:v1:sandbox:654323:customer:${sourceId}`,
        actorUserId: admin,
        action: "quickbooks.sales-mapping.saved",
      },
    }),
  ).toBe(1);
  await expect(
    saveSalesMapping(admin, { ...raw, externalId: "3" }),
  ).rejects.toMatchObject({ status: 409 });
  vi.mocked(provider.quickbooksConfig).mockResolvedValue({ ...config, realm: "999" });
  await expect(saveSalesMapping(admin, raw)).rejects.toMatchObject({ status: 409 });
});
it("enforces CPA read-only access, account types/currency and mapping version conflicts", async () => {
  await expect(saveSalesMapping(cpa, input())).rejects.toMatchObject({
    status: 403,
  });
  expect(provider.readQuickbooksSalesEntity).not.toHaveBeenCalled();
  vi.mocked(provider.readQuickbooksSalesEntity).mockResolvedValueOnce({
    ...account(externalId),
    currency: "EUR",
  });
  await expect(saveSalesMapping(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  await saveSalesMapping(admin, input());
  await expect(saveSalesMapping(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  const view = await salesMappingSources(cpa, { kind: "customer" });
  expect(view.canWrite).toBe(false);
});
it("rolls back an audit failure and refuses a mapping if authorization changes during provider reads", async () => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT "qbo_mapping_test" CHECK (action <> 'quickbooks.sales-mapping.saved') NOT VALID`,
  );
  try {
    await expect(saveSalesMapping(admin, input())).rejects.toThrow();
    expect(
      await prisma.setting.findUnique({
        where: { key: `quickbooks:sales-map:v1:sandbox:654323:customer:${sourceId}` },
      }),
    ).toBeNull();
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT "qbo_mapping_test"',
    );
  }
  vi.mocked(provider.readQuickbooksSalesEntity).mockImplementationOnce(async () => {
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
    return account(externalId);
  });
  await expect(saveSalesMapping(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  expect(
    await prisma.setting.findUnique({
      where: { key: `quickbooks:sales-map:v1:sandbox:654323:customer:${sourceId}` },
    }),
  ).toBeNull();
});
it("rejects a configuration change between initial selection and authorization", async () => {
  vi.mocked(provider.quickbooksConfig)
    .mockResolvedValueOnce(config)
    .mockResolvedValue({ ...config, fingerprint: "changed" });
  await expect(saveSalesMapping(admin, input())).rejects.toMatchObject({ status: 409 });
  expect(provider.readQuickbooksSalesEntity).not.toHaveBeenCalled();
});

it("does not link one remote customer to two households, including concurrent claims", async () => {
  const second = (
    await prisma.customer.create({
      data: {
        user: { create: { email: "synthetic-second-" + randomUUID() + "@example.test" } },
        firstName: "Other",
      },
    })
  ).id;
  const a = input(),
    b = { ...input(), sourceId: second };
  const results = await Promise.allSettled([
    saveSalesMapping(admin, a),
    saveSalesMapping(admin, b),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
it("checks product identity, non-inventory type and active USD income account", async () => {
  const product = await prisma.product.create({
    data: {
      name: "Synthetic mapping",
      slug: randomUUID(),
      brand: "Synthetic",
      variants: { create: { sku: randomUUID(), name: "Synthetic pack" } },
    },
    include: { variants: true },
  });
  const raw = { ...input(), kind: "item", sourceId: product.variants[0].id };
  vi.mocked(provider.readQuickbooksSalesEntity).mockResolvedValue({
    kind: "item",
    id: externalId,
    name: "Synthetic item",
    active: true,
    type: "Inventory",
    tracksQuantity: true,
    incomeAccountId: "9",
  });
  await expect(saveSalesMapping(admin, raw)).rejects.toMatchObject({ status: 409 });
  vi.mocked(provider.readQuickbooksSalesEntity).mockResolvedValue({
    kind: "item",
    id: externalId,
    name: "Synthetic item",
    active: true,
    type: "NonInventory",
    tracksQuantity: false,
    incomeAccountId: "9",
  });
  const income = vi
    .spyOn(provider, "readQuickbooksAccount")
    .mockResolvedValue({
      Id: "9",
      Name: "Synthetic income",
      Active: true,
      AccountType: "Income",
      CurrencyRef: { value: "EUR" },
    });
  await expect(saveSalesMapping(admin, raw)).rejects.toMatchObject({ status: 409 });
  income.mockResolvedValue({
    Id: "9",
    Name: "Synthetic income",
    Active: true,
    AccountType: "Income",
    CurrencyRef: { value: "USD" },
  });
  expect(await saveSalesMapping(admin, raw)).toMatchObject({
    incomeAccountId: "9",
    kind: "item",
    sourceId: raw.sourceId,
  });
});
