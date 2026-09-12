import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sealIntegration } from "@/lib/integrations/secrets";
import * as provider from "@/lib/integrations/quickbooks-client";
import * as sources from "./sales-refund-source";
import {
  prepareQuickbooksReceiptDraft,
  cancelQuickbooksReceiptDraft,
  listQuickbooksReceiptDrafts,
} from "./quickbooks-receipt-drafts";
import { receiptSettingsKey } from "./quickbooks-receipt-settings";
import { salesMappingKey } from "./quickbooks-sales-mapping";
import { preparedReceiptSchema } from "./quickbooks-receipt-drafts";
import {
  submitQuickbooksReceipt,
  reconcileQuickbooksReceipt,
  reconcileScheduledQuickbooksReceipts,
} from "./quickbooks-receipt-posting";
const config = {
  mode: "sandbox" as const,
  clientId: "synthetic",
  clientSecret: "synthetic",
  realm: "654329",
  fingerprint: "synthetic-receipt-drafts",
  redirectUri: "http://localhost:3000/api/admin/quickbooks/callback",
};
const connectionKey = "quickbooks:connection:v1:sandbox",
  users: string[] = [];
let original: Prisma.JsonValue | undefined,
  admin: string,
  cpa: string,
  customerId: string,
  variantId: string;
let sale: Awaited<ReturnType<typeof sources.recordedSaleSource>>;
const value = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
async function setting(key: string, v: unknown) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, valueJson: value(v) },
    update: { valueJson: value(v) },
  });
}
beforeAll(async () => {
  original = (await prisma.setting.findUnique({ where: { key: connectionKey } }))
    ?.valueJson;
  for (const code of ["ADMIN", "CPA", "CUSTOMER"] as const) {
    const role = await prisma.role.upsert({
      where: { code },
      create: { code, name: code },
      update: {},
    });
    const user = await prisma.user.create({
      data: {
        email: `receipt-draft-${randomUUID()}@example.test`,
        userRoles: { create: { roleId: role.id } },
      },
    });
    users.push(user.id);
  }
  [admin, cpa] = users;
  customerId = (
    await prisma.customer.create({ data: { userId: users[2], firstName: "Synthetic" } })
  ).id;
  variantId = (
    await prisma.product.create({
      data: {
        name: "Synthetic receipt",
        slug: randomUUID(),
        brand: "Synthetic",
        variants: { create: { name: "Synthetic pack", sku: randomUUID() } },
      },
      include: { variants: true },
    })
  ).variants[0].id;
});
beforeEach(async () => {
  await setting(connectionKey, {
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
      connectionKey + ":1",
    ),
  });
  const order = await prisma.order.create({
    data: {
      number: "receipt-" + randomUUID(),
      customerId,
      status: "DELIVERED",
      placedAt: new Date("2026-02-01T18:00:00Z"),
      subtotalCents: 3000,
      discountCents: 900,
      taxCents: 168,
      totalCents: 2268,
      items: {
        create: {
          productVariantId: variantId,
          nameSnapshot: "Synthetic item",
          skuSnapshot: "synthetic",
          quantity: 3,
          unitPriceCents: 1000,
          discountCents: 900,
          taxCents: 168,
          lineTotalCents: 2268,
        },
      },
    },
    include: { items: true },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "STRIPE",
      status: "CAPTURED",
      amountCents: 2268,
      currency: "USD",
      externalId: "pi_" + randomUUID(),
    },
  });
  // Native draft/constraint coverage uses a synthetic verified-source adapter. The
  // separate sales-refund-source integration suite exercises actual source ledgers.
  sale = {
    kind: "SALE",
    orderId: order.id,
    sourceId: order.id,
    customerId,
    number: order.number,
    date: "2026-02-01",
    currency: "USD",
    providerAccountId: "acct_synthetic",
    livemode: false,
    paymentId: payment.id,
    paymentIntentId: payment.externalId!,
    sessionId: "cs_synthetic",
    subtotalCents: 3000,
    promotionCents: 300,
    rewardsCents: 600,
    netCents: 2100,
    taxCents: 168,
    cashCents: 2268,
    taxCalculationId: "taxcalc_synthetic",
    taxSnapshotHash: "a".repeat(64),
    address: {
      line1: "1 Synthetic Street",
      line2: "",
      city: "Synthetic",
      region: "IL",
      postalCode: "60000",
      country: "US",
    },
    lines: [
      {
        orderItemId: order.items[0].id,
        variantId,
        name: "Synthetic item",
        sku: "synthetic",
        quantity: 3,
        unitPriceCents: 1000,
        discountCents: 900,
        netCents: 2100,
        taxCents: 168,
        taxCode: "txcd_synthetic",
      },
    ],
  };
  const verifiedAt = new Date().toISOString();
  await setting(receiptSettingsKey(config.mode, config.realm), {
    version: 1,
    mode: config.mode,
    realm: config.realm,
    depositAccount: {
      id: "12",
      name: "Original clearing",
      type: "Bank",
      currency: "USD",
    },
    company: {
      country: "US",
      homeCurrency: "USD",
      usingSalesTax: true,
      partnerTaxEnabled: null,
    },
    verifiedAt,
  });
  for (const [kind, sourceId, externalId] of [
    ["customer", customerId, "21"],
    ["item", variantId, "22"],
  ])
    await setting(salesMappingKey(config.mode, config.realm, kind, sourceId), {
      version: 1,
      kind,
      sourceId,
      mode: config.mode,
      realm: config.realm,
      externalId,
      externalName: "Original " + kind,
      incomeAccountId: kind === "item" ? "23" : null,
      taxCode: kind === "item" ? "TAX" : null,
      verifiedAt,
    });
  vi.spyOn(provider, "quickbooksConfig").mockResolvedValue(config);
  vi.spyOn(sources, "recordedSaleSource").mockImplementation(async () =>
    structuredClone(sale),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await prisma.setting.deleteMany({
    where: {
      OR: [
        { key: connectionKey },
        { key: receiptSettingsKey(config.mode, config.realm) },
        {
          key: { startsWith: `quickbooks:sales-map:v1:${config.mode}:${config.realm}:` },
        },
      ],
    },
  });
  if (original) await setting(connectionKey, original);
  await prisma.user.updateMany({
    where: { id: { in: users } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
const input = () => ({
  requestKey: randomUUID(),
  orderId: sale.orderId,
  confirmed: true,
});
function postingProvider() {
  vi.stubEnv("DD_QBO_RECEIPT_POSTING_ENABLED", "true");
  vi.stubEnv("DD_QBO_RECEIPT_POSTING_COMPANY", config.mode + ":" + config.realm);
  vi.spyOn(provider, "readQuickbooksReceiptCompany").mockResolvedValue({
    country: "US",
    homeCurrency: "USD",
    usingSalesTax: true,
    partnerTaxEnabled: null,
  });
  vi.spyOn(provider, "readQuickbooksAccount").mockImplementation(async (_c, _t, id) => ({
    Id: id,
    Name: "Synthetic account",
    Active: true,
    AccountType: id === "12" ? "Bank" : "Income",
    CurrencyRef: { value: "USD" },
  }));
  vi.spyOn(provider, "readQuickbooksSalesEntity").mockImplementation(
    async (_c, _t, kind, id) =>
      kind === "customer"
        ? { kind, id, name: "Synthetic customer", active: true, currency: "USD" }
        : {
            kind,
            id,
            name: "Synthetic item",
            active: true,
            type: "NonInventory",
            tracksQuantity: false,
            incomeAccountId: "23",
          },
  );
  return vi
    .spyOn(provider, "createQuickbooksCashReceipt")
    .mockImplementation(async (_c, _t, entity, payload) => ({
      [entity]: {
        ...(payload as object),
        Id: "990" + randomUUID().replaceAll(/\D/g, "").slice(0, 12),
        TotalAmt: entity === "SalesReceipt" ? 22.68 : 7.56,
      },
    }));
}
async function evidence(
  id: string,
  remoteId = "990" + randomUUID().replace(/\D/g, "").slice(0, 12),
) {
  const record = await prisma.qboReceiptExport.findUniqueOrThrow({ where: { id } }),
    prepared = preparedReceiptSchema.parse(record.payload);
  return {
    [prepared.entity]: {
      ...prepared.payload,
      Id: remoteId,
      TotalAmt: prepared.entity === "SalesReceipt" ? 22.68 : 7.56,
    },
  };
}
it("claims once before the only provider POST and recovers a lost response through read-only receipt lookup", async () => {
  const create = postingProvider(),
    draft = await prepareQuickbooksReceiptDraft(admin, input()),
    receipt = await evidence(draft.id);
  create.mockImplementation(async () => {
    expect(
      (await prisma.qboReceiptExport.findUniqueOrThrow({ where: { id: draft.id } }))
        .status,
    ).toBe("SUBMITTING");
    expect(
      await prisma.auditLog.count({
        where: { entityId: draft.id, action: "quickbooks.receipt.submitting" },
      }),
    ).toBe(1);
    throw new Error("Synthetic response lost after provider acceptance");
  });
  const results = await Promise.allSettled([
    submitQuickbooksReceipt(admin, draft.id),
    submitQuickbooksReceipt(admin, draft.id),
  ]);
  expect(results.some((r) => r.status === "rejected")).toBe(true);
  expect(create).toHaveBeenCalledTimes(1);
  expect((await submitQuickbooksReceipt(admin, draft.id)).status).toBe("UNKNOWN");
  expect(create).toHaveBeenCalledTimes(1);
  const read = vi
    .spyOn(provider, "findQuickbooksCashReceipt")
    .mockResolvedValue([receipt]);
  expect((await reconcileQuickbooksReceipt(admin, draft.id)).status).toBe("POSTED");
  expect((await reconcileQuickbooksReceipt(admin, draft.id)).status).toBe("POSTED");
  expect(read).toHaveBeenCalledTimes(2);
  expect(
    await prisma.auditLog.count({
      where: { entityId: draft.id, action: "quickbooks.receipt.confirmed" },
    }),
  ).toBe(1);
  expect(create).toHaveBeenCalledTimes(1);
});
it("blocks disabled/wrong-company posting, CPA authority and changed product accounts before any POST", async () => {
  const create = postingProvider(),
    draft = await prepareQuickbooksReceiptDraft(admin, input());
  vi.stubEnv("DD_QBO_RECEIPT_POSTING_COMPANY", "sandbox:other");
  await expect(submitQuickbooksReceipt(admin, draft.id)).rejects.toMatchObject({
    status: 409,
  });
  vi.stubEnv("DD_QBO_RECEIPT_POSTING_COMPANY", "sandbox:" + config.realm);
  await expect(submitQuickbooksReceipt(cpa, draft.id)).rejects.toMatchObject({
    status: 403,
  });
  vi.mocked(provider.readQuickbooksSalesEntity).mockImplementation(
    async (_c, _t, kind, id) =>
      kind === "customer"
        ? { kind, id, name: "Synthetic", active: true, currency: "USD" }
        : {
            kind,
            id,
            name: "Synthetic",
            active: true,
            type: "Inventory",
            tracksQuantity: true,
            incomeAccountId: "23",
          },
  );
  await expect(submitQuickbooksReceipt(admin, draft.id)).rejects.toMatchObject({
    status: 409,
  });
  expect(create).not.toHaveBeenCalled();
  expect(
    (await prisma.qboReceiptExport.findUniqueOrThrow({ where: { id: draft.id } })).status,
  ).toBe("DRAFT");
});
it("rolls back a failed submission audit and refuses changed local mappings before the provider send", async () => {
  const create = postingProvider(),
    draft = await prepareQuickbooksReceiptDraft(admin, input());
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT "receipt_claim_audit_test" CHECK (action <> 'quickbooks.receipt.submitting') NOT VALID`,
  );
  try {
    await expect(submitQuickbooksReceipt(admin, draft.id)).rejects.toThrow();
    expect(
      (await prisma.qboReceiptExport.findUniqueOrThrow({ where: { id: draft.id } }))
        .status,
    ).toBe("DRAFT");
    expect(create).not.toHaveBeenCalled();
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT "receipt_claim_audit_test"',
    );
  }
  const key = salesMappingKey(config.mode, config.realm, "item", variantId),
    row = await prisma.setting.findUniqueOrThrow({ where: { key } });
  await setting(key, {
    ...(row.valueJson as Prisma.JsonObject),
    version: 2,
    taxCode: "NON",
  });
  await expect(submitQuickbooksReceipt(admin, draft.id)).rejects.toMatchObject({
    status: 409,
  });
  expect(create).not.toHaveBeenCalled();
});
it("keeps an accepted-but-unrecorded receipt held after confirmation audit failure and lets the worker recover without sending", async () => {
  const create = postingProvider(),
    draft = await prepareQuickbooksReceiptDraft(admin, input()),
    receipt = await evidence(draft.id);
  create.mockResolvedValue(receipt);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT "receipt_confirmation_audit_test" CHECK (action <> 'quickbooks.receipt.confirmed') NOT VALID`,
  );
  try {
    await expect(submitQuickbooksReceipt(admin, draft.id)).rejects.toMatchObject({
      status: 503,
    });
    expect(
      (await prisma.qboReceiptExport.findUniqueOrThrow({ where: { id: draft.id } }))
        .status,
    ).toBe("UNKNOWN");
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT "receipt_confirmation_audit_test"',
    );
  }
  vi.spyOn(provider, "findQuickbooksCashReceipt").mockResolvedValue([receipt]);
  // Other test receipts in this isolated company are excluded from this due batch.
  await prisma.qboReceiptExport.updateMany({
    where: { mode: config.mode, realm: config.realm, id: { not: draft.id } },
    data: { recoveryCheckedAt: new Date() },
  });
  const result = await reconcileScheduledQuickbooksReceipts(async () => true);
  expect(result.checked).toBe(1);
  expect(result.completed).toBe(1);
  expect(
    (await prisma.qboReceiptExport.findUniqueOrThrow({ where: { id: draft.id } })).status,
  ).toBe("POSTED");
  expect(create).toHaveBeenCalledTimes(1);
  await expect(reconcileScheduledQuickbooksReceipts(async () => false)).rejects.toThrow(
    "Worker lease expired",
  );
});
it("holds ambiguous or changed-tax evidence and never reopens a submitted receipt for another send", async () => {
  const create = postingProvider(),
    draft = await prepareQuickbooksReceiptDraft(admin, input()),
    receipt = await evidence(draft.id);
  create.mockRejectedValue(new Error("Synthetic timeout"));
  await expect(submitQuickbooksReceipt(admin, draft.id)).rejects.toMatchObject({
    status: 503,
  });
  const read = vi
    .spyOn(provider, "findQuickbooksCashReceipt")
    .mockResolvedValue([receipt, receipt]);
  await expect(reconcileQuickbooksReceipt(admin, draft.id)).rejects.toMatchObject({
    status: 409,
  });
  read.mockResolvedValue([
    { SalesReceipt: { ...receipt.SalesReceipt, TxnTaxDetail: { TotalTax: 1.69 } } },
  ]);
  await expect(reconcileQuickbooksReceipt(admin, draft.id)).rejects.toThrow();
  expect(
    (await prisma.qboReceiptExport.findUniqueOrThrow({ where: { id: draft.id } }))
      .reconciliationIssue,
  ).toBe("EVIDENCE_UNCONFIRMED");
  await expect(cancelQuickbooksReceiptDraft(admin, draft.id)).rejects.toMatchObject({
    status: 409,
  });
  expect((await submitQuickbooksReceipt(admin, draft.id)).status).toBe("UNKNOWN");
  expect(create).toHaveBeenCalledTimes(1);
});
it("blocks a refund that failed before posting and keeps a later refund failure flagged after receipt reconciliation", async () => {
  const create = postingProvider(),
    parent = await prepareQuickbooksReceiptDraft(admin, input());
  await submitQuickbooksReceipt(admin, parent.id);
  const refunds = new Map<
    string,
    Awaited<ReturnType<typeof sources.recordedRefundSource>>
  >();
  vi.spyOn(sources, "recordedRefundSource").mockImplementation(
    async (_tx, _orderId, id) => refunds.get(id)!,
  );
  async function refundFixture() {
    const providerRefundId = "re_" + randomUUID();
    const request = await prisma.refundRequest.create({
      data: {
        orderId: sale.orderId,
        paymentId: sale.paymentId,
        actorUserId: admin,
        requestKey: randomUUID(),
        requestHash: randomUUID(),
        amountCents: 756,
        currency: "USD",
        reason: "Synthetic failed refund receipt",
        providerAccountId: "acct_synthetic",
        livemode: false,
        providerRefundId,
        status: "SUCCEEDED",
        submittedAt: new Date(),
      },
    });
    const a = await prisma.refundAdjustment.create({
      data: {
        requestId: request.id,
        kind: "SETTLEMENT",
        cashCents: 756,
        netCents: 700,
        taxCents: 56,
        rewardCents: 200,
        currency: "USD",
        providerRefundId,
      },
    });
    refunds.set(a.id, {
      kind: "SETTLEMENT",
      orderId: sale.orderId,
      sourceId: a.id,
      requestId: request.id,
      customerId,
      number: sale.number,
      date: "2026-02-02",
      currency: "USD",
      cashCents: 756,
      netCents: 700,
      taxCents: 56,
      rewardCents: 200,
      providerRefundId,
      taxEvidenceStatus: "MATCHED",
      taxEvidenceId: "synthetic",
      originalTaxTransactionId: "tax_original",
      refundTaxTransactionId: "tax_refund",
      requiresCashReceipt: true,
      lines: [
        {
          orderItemId: sale.lines[0].orderItemId,
          variantId,
          name: "Synthetic",
          sku: "synthetic",
          quantity: 1,
          netCents: 700,
          taxCents: 56,
          rewardCents: 200,
        },
      ],
    });
    const draft = await prepareQuickbooksReceiptDraft(admin, {
      ...input(),
      adjustmentId: a.id,
    });
    return { request, draft };
  }
  const first = await refundFixture();
  await prisma.refundRequest.update({
    where: { id: first.request.id },
    data: { status: "FAILED" },
  });
  await expect(submitQuickbooksReceipt(admin, first.draft.id)).rejects.toMatchObject({
    status: 409,
  });
  expect(create).toHaveBeenCalledTimes(1);
  const second = await refundFixture(),
    posted = await submitQuickbooksReceipt(admin, second.draft.id);
  expect(posted.status).toBe("POSTED");
  expect(create).toHaveBeenCalledTimes(2);
  await prisma.refundRequest.update({
    where: { id: second.request.id },
    data: { status: "FAILED" },
  });
  vi.spyOn(provider, "findQuickbooksCashReceipt").mockResolvedValue([
    await evidence(second.draft.id, posted.externalId!),
  ]);
  expect(
    (await reconcileQuickbooksReceipt(admin, second.draft.id)).reconciliationIssue,
  ).toBe("REFUND_COMPENSATION_REVIEW");
  expect(
    (await reconcileQuickbooksReceipt(admin, second.draft.id)).reconciliationIssue,
  ).toBe("REFUND_COMPENSATION_REVIEW");
  expect(create).toHaveBeenCalledTimes(2);
  vi.spyOn(provider, "findQuickbooksCashReceipt").mockRejectedValue(
    new Error("Synthetic provider read outage"),
  );
  await expect(reconcileQuickbooksReceipt(admin, second.draft.id)).rejects.toThrow(
    /outage/,
  );
  expect(
    (await prisma.qboReceiptExport.findUniqueOrThrow({ where: { id: second.draft.id } }))
      .reconciliationIssue,
  ).toBe("REFUND_COMPENSATION_REVIEW");
  expect(create).toHaveBeenCalledTimes(2);
});
it("prepares one immutable receipt across retries, keeps cancellation history and prevents duplicate active sources", async () => {
  const raw = input(),
    results = await Promise.all([
      prepareQuickbooksReceiptDraft(admin, raw),
      prepareQuickbooksReceiptDraft(admin, raw),
    ]);
  expect(results[0]).toEqual(results[1]);
  const e = results[0];
  expect(e).toMatchObject({
    status: "DRAFT",
    entity: "SalesReceipt",
    cashCents: 2268,
    clearingAccount: "Original clearing",
  });
  expect(
    await prisma.auditLog.count({
      where: { entityId: e.id, action: "quickbooks.receipt.prepared" },
    }),
  ).toBe(1);
  await expect(prepareQuickbooksReceiptDraft(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    prepareQuickbooksReceiptDraft(admin, { ...raw, adjustmentId: "different" }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    prisma.qboReceiptExport.update({ where: { id: e.id }, data: { source: {} } }),
  ).rejects.toThrow();
  await expect(prisma.qboReceiptExport.delete({ where: { id: e.id } })).rejects.toThrow();
  await cancelQuickbooksReceiptDraft(admin, e.id);
  await cancelQuickbooksReceiptDraft(admin, e.id);
  expect(
    await prisma.auditLog.count({
      where: { entityId: e.id, action: "quickbooks.receipt.canceled" },
    }),
  ).toBe(1);
  await expect(
    prisma.qboReceiptExport.update({ where: { id: e.id }, data: { status: "DRAFT" } }),
  ).rejects.toThrow();
  expect((await prepareQuickbooksReceiptDraft(admin, input())).id).not.toBe(e.id);
  expect((await listQuickbooksReceiptDrafts(cpa)).canWrite).toBe(false);
});
it("blocks CPA writes, unknown tax mappings, wrong companies and incomplete source evidence", async () => {
  await expect(prepareQuickbooksReceiptDraft(cpa, input())).rejects.toMatchObject({
    status: 403,
  });
  const key = salesMappingKey(config.mode, config.realm, "item", variantId),
    row = await prisma.setting.findUniqueOrThrow({ where: { key } });
  const before = row.valueJson as Prisma.JsonObject;
  await setting(key, { ...before, taxCode: null });
  await expect(prepareQuickbooksReceiptDraft(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  await setting(key, { ...before, realm: "999" });
  await expect(prepareQuickbooksReceiptDraft(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  await setting(key, before);
  vi.mocked(sources.recordedSaleSource).mockResolvedValueOnce({ ...sale, taxCents: 999 });
  await expect(prepareQuickbooksReceiptDraft(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  expect(await prisma.qboReceiptExport.count({ where: { orderId: sale.orderId } })).toBe(
    0,
  );
});
it("rolls back draft creation when its audit fails", async () => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT "receipt_draft_audit_test" CHECK (action <> 'quickbooks.receipt.prepared') NOT VALID`,
  );
  try {
    await expect(prepareQuickbooksReceiptDraft(admin, input())).rejects.toThrow();
    expect(
      await prisma.qboReceiptExport.count({ where: { orderId: sale.orderId } }),
    ).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT "receipt_draft_audit_test"',
    );
  }
});
it("requires a posted original sale and preserves its mapping when preparing a matched cash refund", async () => {
  const providerRefundId = "re_" + randomUUID();
  const request = await prisma.refundRequest.create({
    data: {
      orderId: sale.orderId,
      paymentId: sale.paymentId,
      actorUserId: admin,
      requestKey: randomUUID(),
      requestHash: randomUUID(),
      amountCents: 756,
      currency: "USD",
      reason: "Synthetic draft",
      providerAccountId: "acct_synthetic",
      livemode: false,
      providerRefundId,
      status: "SUCCEEDED",
      submittedAt: new Date(),
    },
  });
  const adjustment = await prisma.refundAdjustment.create({
    data: {
      requestId: request.id,
      kind: "SETTLEMENT",
      cashCents: 756,
      netCents: 700,
      taxCents: 56,
      rewardCents: 200,
      currency: "USD",
      providerRefundId,
    },
  });
  const refund = {
    kind: "SETTLEMENT" as const,
    orderId: sale.orderId,
    sourceId: adjustment.id,
    requestId: request.id,
    customerId,
    number: sale.number,
    date: "2026-02-02",
    currency: "USD" as const,
    cashCents: 756,
    netCents: 700,
    taxCents: 56,
    rewardCents: 200,
    providerRefundId,
    taxEvidenceStatus: "MATCHED" as const,
    taxEvidenceId: "synthetic",
    originalTaxTransactionId: "tax_original",
    refundTaxTransactionId: "tax_refund",
    requiresCashReceipt: true,
    lines: [
      {
        orderItemId: sale.lines[0].orderItemId,
        variantId,
        name: "Synthetic",
        sku: "synthetic",
        quantity: 1,
        netCents: 700,
        taxCents: 56,
        rewardCents: 200,
      },
    ],
  };
  vi.spyOn(sources, "recordedRefundSource").mockResolvedValue(refund);
  const raw = { ...input(), adjustmentId: adjustment.id };
  await expect(prepareQuickbooksReceiptDraft(admin, raw)).rejects.toMatchObject({
    status: 409,
  });
  const parent = await prepareQuickbooksReceiptDraft(admin, input());
  await expect(prepareQuickbooksReceiptDraft(admin, raw)).rejects.toMatchObject({
    status: 409,
  });
  // Explicit synthetic provider acceptance, only in this isolated database test.
  await prisma.qboReceiptExport.update({
    where: { id: parent.id },
    data: { status: "SUBMITTING", submittedAt: new Date() },
  });
  await prisma.qboReceiptExport.update({
    where: { id: parent.id },
    data: { status: "POSTED", externalId: "900", confirmedAt: new Date() },
  });
  const key = receiptSettingsKey(config.mode, config.realm),
    row = await prisma.setting.findUniqueOrThrow({ where: { key } });
  await setting(key, {
    ...(row.valueJson as Prisma.JsonObject),
    version: 2,
    depositAccount: { id: "99", name: "Changed clearing", type: "Bank", currency: "USD" },
  });
  vi.mocked(sources.recordedRefundSource).mockResolvedValueOnce({
    ...refund,
    taxEvidenceStatus: "UNVERIFIED",
  });
  await expect(prepareQuickbooksReceiptDraft(admin, raw)).rejects.toMatchObject({
    status: 409,
  });
  const draft = await prepareQuickbooksReceiptDraft(admin, raw);
  expect(draft).toMatchObject({
    entity: "RefundReceipt",
    parentSaleId: parent.id,
    cashCents: 756,
    clearingAccount: "Original clearing",
  });
  const saved = await prisma.qboReceiptExport.findUniqueOrThrow({
    where: { id: draft.id },
  });
  expect(saved.mapping).toEqual(
    (await prisma.qboReceiptExport.findUniqueOrThrow({ where: { id: parent.id } }))
      .mapping,
  );
  await cancelQuickbooksReceiptDraft(admin, draft.id);
  await expect(
    prisma.qboReceiptExport.create({
      data: {
        id: randomUUID(),
        orderId: saved.orderId,
        adjustmentId: saved.adjustmentId,
        parentSaleId: saved.parentSaleId,
        sourceKey: saved.sourceKey,
        entity: saved.entity,
        mode: saved.mode,
        realm: saved.realm,
        docNumber: "DR" + "f".repeat(19),
        requestHash: "synthetic",
        source: saved.source as Prisma.InputJsonValue,
        payload: saved.payload as Prisma.InputJsonValue,
        mapping: { ...(saved.mapping as Prisma.JsonObject), syntheticMismatch: true },
      },
    }),
  ).rejects.toThrow(/original sale|original company mapping/);
  await expect(cancelQuickbooksReceiptDraft(admin, parent.id)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    prisma.qboReceiptExport.update({
      where: { id: parent.id },
      data: { externalId: "901" },
    }),
  ).rejects.toThrow();
});
