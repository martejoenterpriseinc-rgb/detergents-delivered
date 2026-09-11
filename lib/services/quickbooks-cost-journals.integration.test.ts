import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sealIntegration } from "@/lib/integrations/secrets";
import * as provider from "@/lib/integrations/quickbooks-client";
import { recordStockReturn } from "./refunds";
import {
  prepareQuickbooksCostJournal as prepare,
  submitQuickbooksCostJournal as submit,
  cancelQuickbooksCostJournal as cancel,
  reconcileQuickbooksCostJournal as reconcile,
  reconcileScheduledQuickbooksCostJournals as work,
} from "./quickbooks-cost-journals";
const key = "quickbooks:connection:v1:sandbox",
  mapKey = "quickbooks:cost-map:v1:sandbox:98765432";
const config = {
  mode: "sandbox" as const,
  clientId: "synthetic",
  clientSecret: "synthetic",
  realm: "98765432",
  fingerprint: "synthetic-journal",
  redirectUri: "http://localhost:3000/api/admin/quickbooks/callback",
};
let original: Prisma.JsonValue | undefined;
beforeAll(async () => {
  original = (await prisma.setting.findUnique({ where: { key } }))?.valueJson;
});
let marker: string;
let checkoutId: string;
const users: string[] = [];
let admin: string,
  cpa: string,
  customer: string,
  order: string,
  item: string,
  variant: string,
  layer: string;

beforeEach(async () => {
  marker = randomUUID();
  checkoutId = randomUUID();
  for (const code of ["ADMIN", "CPA", "CUSTOMER"] as const) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    const user = await prisma.user.create({
      data: {
        email: `cost-journal-${code.toLowerCase()}-${marker}@example.test`,
        userRoles: { create: { roleId: role.id } },
      },
    });
    users.push(user.id);
  }
  [admin, cpa] = users.slice(-3);
  customer = (
    await prisma.customer.create({ data: { userId: users.at(-1)!, firstName: marker } })
  ).id;
  const savedProduct = await prisma.product.create({
    data: {
      name: "Synthetic return product",
      brand: "Synthetic",
      slug: marker,
      variants: { create: { name: "Three pack", sku: marker } },
    },
    include: { variants: true },
  });
  variant = savedProduct.variants[0].id;
  await prisma.inventoryBalance.create({ data: { productVariantId: variant } });
  layer = (
    await prisma.inventoryCostLayer.create({
      data: {
        productVariantId: variant,
        quantityOriginal: 1,
        quantityRemaining: 0,
        landedUnitCostCents: 400,
        receivedAt: new Date("2026-01-01T00:00:00Z"),
      },
    })
  ).id;
  const otherLayers = await Promise.all(
    [500, 600].map((cost, index) =>
      prisma.inventoryCostLayer.create({
        data: {
          productVariantId: variant,
          quantityOriginal: 1,
          quantityRemaining: 0,
          landedUnitCostCents: cost,
          receivedAt: new Date(`2026-01-0${index + 2}T00:00:00Z`),
        },
      }),
    ),
  );
  const savedOrder = await prisma.order.create({
    data: {
      number: `cost-journal-${marker}`,
      customerId: customer,
      status: "DELIVERED",
      placedAt: new Date("2026-02-01T18:00:00Z"),
      subtotalCents: 3000,
      taxCents: 240,
      totalCents: 3240,
      items: {
        create: {
          productVariantId: variant,
          nameSnapshot: "Historical product",
          skuSnapshot: marker,
          quantity: 3,
          unitPriceCents: 1000,
          taxCents: 240,
          lineTotalCents: 3240,
        },
      },
    },
    include: { items: true },
  });
  order = savedOrder.id;
  item = savedOrder.items[0].id;
  await prisma.payment.create({
    data: {
      orderId: order,
      provider: "STRIPE",
      status: "CAPTURED",
      amountCents: 3240,
      externalId: `pi_${marker}`,
      events: {
        create: {
          type: "checkout.session.completed",
          externalId: `checkout:${checkoutId}:paid`,
          verifiedAt: new Date(),
        },
      },
    },
  });
  await prisma.checkoutAttempt.create({
    data: {
      id: checkoutId,
      state: "PAID",
      customerId: customer,
      requestKey: randomUUID(),
      requestHash: marker,
      snapshot: {},
      expiresAt: new Date(),
      stripeAccountId: "acct_synthetic",
      livemode: false,
      orderId: order,
      costs: {
        create: [
          {
            costLayerId: layer,
            quantity: 1,
            unitCostCents: 400,
            state: "CONSUMED",
          },
          ...otherLayers.map((cost) => ({
            costLayerId: cost.id,
            quantity: 1,
            unitCostCents: cost.landedUnitCostCents,
            state: "CONSUMED" as const,
          })),
        ],
      },
    },
  });
});

beforeEach(async () => {
  const connection = {
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
    create: { key, valueJson: connection },
    update: { valueJson: connection },
  });
  const mapping = {
    version: 1,
    mode: "sandbox",
    realm: config.realm,
    costAccount: {
      id: "1",
      name: "Synthetic cost",
      type: "Cost of Goods Sold",
      currency: "USD",
    },
    inventoryAccount: {
      id: "2",
      name: "Synthetic inventory",
      type: "Other Current Asset",
      currency: "USD",
    },
    verifiedAt: new Date().toISOString(),
  };
  await prisma.setting.upsert({
    where: { key: mapKey },
    create: { key: mapKey, valueJson: mapping },
    update: { valueJson: mapping },
  });
  vi.spyOn(provider, "quickbooksConfig").mockResolvedValue(config);
  vi.spyOn(provider, "readQuickbooksAccount").mockImplementation(async (_c, _t, id) => ({
    Id: id,
    Name: "Synthetic",
    AccountType: id === "1" ? "Cost of Goods Sold" : "Other Current Asset",
    Active: true,
    CurrencyRef: { value: "USD" },
  }));
  vi.stubEnv("DD_QBO_COST_POSTING_ENABLED", "true");
  vi.stubEnv("DD_QBO_COST_POSTING_COMPANY", "sandbox:" + config.realm);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { in: [key, mapKey] } } });
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
const input = (returnId?: string) => ({
  requestKey: randomUUID(),
  orderId: order,
  ...(returnId ? { returnId } : {}),
  confirmed: true,
});
async function receipt(id: string, externalId = "123") {
  return {
    ...((await prisma.qboCostExport.findUniqueOrThrow({ where: { id } }))
      .payload as Prisma.JsonObject),
    Id: externalId,
  };
}
const stockReturn = (condition: "SELLABLE" | "DAMAGED" = "SELLABLE") =>
  recordStockReturn(admin, {
    requestKey: randomUUID(),
    orderId: order,
    reason: "Synthetic journal return",
    lines: [{ orderItemId: item, quantity: 1, condition }],
  });
it("prepares one immutable audited draft with strict replay and permission checks", async () => {
  const raw = input(),
    [a, b] = await Promise.all([prepare(admin, raw), prepare(admin, raw)]);
  expect(a.id).toBe(b.id);
  expect(a.source.amountCents).toBe(1500);
  await expect(prepare(cpa, input())).rejects.toMatchObject({ status: 403 });
  await expect(
    prisma.qboCostExport.update({
      where: { id: a.id },
      data: { payload: { changed: true } },
    }),
  ).rejects.toThrow();
  await expect(prisma.qboCostExport.delete({ where: { id: a.id } })).rejects.toThrow();
  await cancel(admin, a.id);
  await cancel(admin, a.id);
  expect((await prepare(admin, input())).id).not.toBe(a.id);
});
it("claims one submission, protects uncertainty and reconciles exactly once with sends disabled", async () => {
  const draft = await prepare(admin, input()),
    send = vi
      .spyOn(provider, "createQuickbooksCostJournal")
      .mockRejectedValue(new Error("synthetic lost response"));
  vi.stubEnv("DD_QBO_COST_POSTING_ENABLED", "false");
  await expect(submit(admin, draft.id)).rejects.toMatchObject({ status: 409 });
  expect(send).not.toHaveBeenCalled();
  vi.stubEnv("DD_QBO_COST_POSTING_ENABLED", "true");
  await Promise.allSettled([submit(admin, draft.id), submit(admin, draft.id)]);
  expect(send).toHaveBeenCalledTimes(1);
  await submit(admin, draft.id);
  expect(send).toHaveBeenCalledTimes(1);
  await expect(cancel(admin, draft.id)).rejects.toMatchObject({ status: 409 });
  await expect(prepare(admin, input())).rejects.toMatchObject({ status: 409 });
  vi.spyOn(provider, "findQuickbooksCostJournal").mockResolvedValue([
    await receipt(draft.id, "201"),
  ]);
  vi.stubEnv("DD_QBO_COST_POSTING_ENABLED", "false");
  await Promise.all([reconcile(admin, draft.id), reconcile(admin, draft.id)]);
  expect(
    await prisma.auditLog.count({
      where: { entityId: draft.id, action: "quickbooks.cost.confirmed" },
    }),
  ).toBe(1);
  await expect(
    prisma.qboCostExport.update({ where: { id: draft.id }, data: { externalId: "999" } }),
  ).rejects.toThrow();
});
it("requires the posted sale and reverses only sellable cost using the original accounts", async () => {
  const returned = await stockReturn();
  await expect(prepare(admin, input(returned.id))).rejects.toMatchObject({ status: 409 });
  const sale = await prepare(admin, input());
  vi.spyOn(provider, "createQuickbooksCostJournal").mockResolvedValue(
    await receipt(sale.id, "202"),
  );
  await submit(admin, sale.id);
  const row = await prisma.setting.findUniqueOrThrow({ where: { key: mapKey } });
  await prisma.setting.update({
    where: { key: mapKey },
    data: {
      valueJson: {
        ...(row.valueJson as Prisma.JsonObject),
        version: 2,
        costAccount: {
          id: "77",
          name: "New cost account",
          type: "Cost of Goods Sold",
          currency: "USD",
        },
      },
    },
  });
  const reversal = await prepare(admin, input(returned.id));
  expect(reversal.source.amountCents).toBe(400);
  expect(reversal.mapping.costAccount.id).toBe("1");
  const payload = (
    await prisma.qboCostExport.findUniqueOrThrow({ where: { id: reversal.id } })
  ).payload as {
    Line: Array<{
      JournalEntryLineDetail: { PostingType: string; AccountRef: { value: string } };
    }>;
  };
  expect(payload.Line.map((l) => l.JournalEntryLineDetail)).toEqual([
    { PostingType: "Debit", AccountRef: { value: "2" } },
    { PostingType: "Credit", AccountRef: { value: "1" } },
  ]);
  vi.mocked(provider.createQuickbooksCostJournal).mockResolvedValue(
    await receipt(reversal.id, "203"),
  );
  await submit(admin, reversal.id);
  const damaged = await stockReturn("DAMAGED");
  await expect(prepare(admin, input(damaged.id))).rejects.toMatchObject({ status: 409 });
});
it("rolls back confirmation audit failure and lets the worker recover without resending", async () => {
  const draft = await prepare(admin, input()),
    send = vi
      .spyOn(provider, "createQuickbooksCostJournal")
      .mockResolvedValue(await receipt(draft.id, "204"));
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT "qbo_cost_audit" CHECK (action <> 'quickbooks.cost.confirmed') NOT VALID`,
  );
  try {
    await expect(submit(admin, draft.id)).rejects.toMatchObject({ status: 503 });
    expect(
      (await prisma.qboCostExport.findUniqueOrThrow({ where: { id: draft.id } }))
        .externalId,
    ).toBeNull();
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT "qbo_cost_audit"',
    );
  }
  vi.spyOn(provider, "findQuickbooksCostJournal").mockImplementation(
    async (_c, _t, doc) => {
      const row = await prisma.qboCostExport.findFirst({ where: { docNumber: doc } });
      return row ? [await receipt(row.id, row.externalId ?? "204")] : [];
    },
  );
  vi.stubEnv("DD_QBO_COST_POSTING_ENABLED", "false");
  await work(async () => true);
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    (await prisma.qboCostExport.findUniqueOrThrow({ where: { id: draft.id } })).status,
  ).toBe("POSTED");
  expect(
    await prisma.auditLog.findFirst({
      where: { entityId: draft.id, action: "quickbooks.cost.confirmed" },
    }),
  ).toMatchObject({ actorUserId: null });
  await expect(work(async () => false)).rejects.toThrow(/lease/);
});
it("keeps wrong-company, duplicate and mismatched receipts blocked", async () => {
  const draft = await prepare(admin, input());
  vi.spyOn(provider, "createQuickbooksCostJournal").mockRejectedValue(
    new Error("synthetic timeout"),
  );
  await expect(submit(admin, draft.id)).rejects.toThrow();
  const find = vi.spyOn(provider, "findQuickbooksCostJournal").mockResolvedValue([]);
  await expect(reconcile(admin, draft.id)).rejects.toMatchObject({ status: 409 });
  find.mockResolvedValue([
    await receipt(draft.id, "205"),
    await receipt(draft.id, "206"),
  ]);
  await expect(reconcile(admin, draft.id)).rejects.toMatchObject({ status: 409 });
  find.mockResolvedValue([
    { ...(await receipt(draft.id, "205")), TxnDate: "2020-01-01" },
  ]);
  await expect(reconcile(admin, draft.id)).rejects.toThrow();
  vi.mocked(provider.quickbooksConfig).mockResolvedValue({ ...config, realm: "999" });
  await expect(reconcile(admin, draft.id)).rejects.toThrow();
  expect(
    (await prisma.qboCostExport.findUniqueOrThrow({ where: { id: draft.id } })).status,
  ).toBe("UNKNOWN");
});
