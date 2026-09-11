import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type QboReceiptExport } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { prepareCashReceipt, cashReceiptPayload } from "@/lib/domain/quickbooks-receipt";
import { financeAccess } from "./finance";
import { quickbooksConfig } from "@/lib/integrations/quickbooks-client";
import { authorizedQuickbooks, assertQuickbooksSnapshot } from "./quickbooks-connection";
import { recordedSaleSource, recordedRefundSource } from "./sales-refund-source";
import { receiptSettingsKey, receiptSettingsSchema } from "./quickbooks-receipt-settings";
import { salesMappingKey, salesMappingSchema } from "./quickbooks-sales-mapping";
const idSchema = z.string().min(1).max(100);
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export const receiptExportMapping = z
  .object({
    settings: receiptSettingsSchema,
    customer: salesMappingSchema,
    items: z.array(salesMappingSchema).min(1).max(30),
  })
  .strict();
export const preparedReceiptSchema = z
  .object({
    entity: z.enum(["SalesReceipt", "RefundReceipt"]),
    payload: cashReceiptPayload,
    cashCents: z.number().int().positive().max(100000000),
    sourceId: idSchema,
  })
  .strict();
export function receiptExportView(e: QboReceiptExport) {
  const payload = preparedReceiptSchema.parse(e.payload),
    mapping = receiptExportMapping.parse(e.mapping);
  const source = z.object({ sale: z.object({ number: z.string() }) }).parse(e.source);
  return {
    id: e.id,
    orderId: e.orderId,
    adjustmentId: e.adjustmentId,
    parentSaleId: e.parentSaleId,
    entity: e.entity,
    status: e.status,
    realm: e.realm,
    docNumber: e.docNumber,
    number: source.sale.number,
    date: payload.payload.TxnDate,
    cashCents: payload.cashCents,
    clearingAccount: mapping.settings.depositAccount.name,
    customerName: mapping.customer.externalName,
    externalId: e.externalId,
    reconciliationIssue: e.reconciliationIssue,
    submittedAt: e.submittedAt?.toISOString() ?? null,
    confirmedAt: e.confirmedAt?.toISOString() ?? null,
  };
}
export async function receiptOrderLock(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM "Order" WHERE id=${id} FOR UPDATE`;
  if (!rows.length) throw new AccountError("Order not found.", 404);
}
export function receiptCompilerMapping(
  raw: unknown,
  sale: Awaited<ReturnType<typeof recordedSaleSource>>,
  mode: string,
  realm: string,
) {
  const m = receiptExportMapping.parse(raw);
  if (
    m.settings.mode !== mode ||
    m.settings.realm !== realm ||
    m.customer.mode !== mode ||
    m.customer.realm !== realm ||
    m.customer.kind !== "customer" ||
    m.customer.sourceId !== sale.customerId ||
    m.items.length !== sale.lines.length ||
    new Set(m.items.map((i) => i.sourceId)).size !== m.items.length ||
    new Set(m.items.map((i) => i.externalId)).size !== m.items.length ||
    m.items.some(
      (i) =>
        i.kind !== "item" ||
        i.mode !== mode ||
        i.realm !== realm ||
        !i.taxCode ||
        !i.incomeAccountId ||
        !sale.lines.some((l) => l.variantId === i.sourceId),
    )
  )
    throw new AccountError(
      "Receipt customer, product or tax mappings require review in this company.",
      409,
    );
  return {
    customerId: sale.customerId,
    customerRef: { value: m.customer.externalId },
    depositRef: { value: m.settings.depositAccount.id },
    items: m.items.map((i) => ({
      variantId: i.sourceId,
      itemRef: { value: i.externalId },
      taxCode: i.taxCode!,
    })),
  };
}
export async function currentReceiptMapping(
  tx: Prisma.TransactionClient,
  sale: Awaited<ReturnType<typeof recordedSaleSource>>,
  mode: string,
  realm: string,
) {
  const settingsKey = receiptSettingsKey(mode, realm),
    customerKey = salesMappingKey(mode, realm, "customer", sale.customerId);
  const keys = sale.lines.map((l) => salesMappingKey(mode, realm, "item", l.variantId));
  const rows = await tx.setting.findMany({
    where: { key: { in: [settingsKey, customerKey, ...keys] } },
  });
  const value = (key: string) => {
    const row = rows.find((r) => r.key === key);
    if (!row)
      throw new AccountError(
        "Review receipt clearing, customer and product tax mappings first.",
        409,
      );
    return row.valueJson;
  };
  return receiptExportMapping.parse({
    settings: value(settingsKey),
    customer: value(customerKey),
    items: keys.map(value),
  });
}
export async function listQuickbooksReceiptDrafts(actor: string, cursor?: string) {
  idSchema.optional().parse(cursor);
  const canWrite = await financeAccess(prisma, actor),
    config = await quickbooksConfig();
  const rows = await prisma.qboReceiptExport.findMany({
    where: { mode: config.mode, realm: config.realm },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return {
    canWrite,
    canSubmit: receiptPostingAllowed(config.mode, config.realm),
    nextCursor: rows.length > 50 ? rows[49].id : null,
    rows: rows.slice(0, 50).map(receiptExportView),
  };
}
export function receiptPostingAllowed(mode: string, realm: string) {
  return (
    process.env.DD_QBO_RECEIPT_POSTING_ENABLED === "true" &&
    process.env.DD_QBO_RECEIPT_POSTING_COMPANY === mode + ":" + realm
  );
}
export async function prepareQuickbooksReceiptDraft(actor: string, raw: unknown) {
  const input = z
    .object({
      requestKey: z.uuid(),
      orderId: idSchema,
      adjustmentId: idSchema.optional(),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const config = await quickbooksConfig(),
    id = "qbr_" + digest(actor + ":" + input.requestKey),
    requestHash = digest(JSON.stringify(input));
  const replay = (e: QboReceiptExport) => {
    if (
      e.requestHash !== requestHash ||
      e.mode !== config.mode ||
      e.realm !== config.realm
    )
      throw new AccountError(
        "This receipt request was already used for different choices.",
        409,
      );
    return receiptExportView(e);
  };
  const existing = await prisma.qboReceiptExport.findUnique({ where: { id } });
  if (existing) return replay(existing);
  const snapshot = await authorizedQuickbooks(actor);
  if (snapshot.config.fingerprint !== config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    await receiptOrderLock(tx, input.orderId);
    const prior = await tx.qboReceiptExport.findUnique({ where: { id } });
    if (prior) return replay(prior);
    const sourceKey = input.adjustmentId
      ? "refund:" + input.adjustmentId
      : "sale:" + input.orderId;
    if (
      await tx.qboReceiptExport.findFirst({
        where: { sourceKey, status: { not: "CANCELED" } },
      })
    )
      throw new AccountError(
        "This source already has a receipt export. Review that export first.",
        409,
      );
    const sale = await recordedSaleSource(tx, input.orderId),
      refund = input.adjustmentId
        ? await recordedRefundSource(tx, input.orderId, input.adjustmentId)
        : null;
    if (
      refund &&
      (refund.kind !== "SETTLEMENT" ||
        refund.cashCents <= 0 ||
        refund.taxEvidenceStatus !== "MATCHED")
    )
      throw new AccountError(
        "Only cash settlements with matched tax evidence can prepare a refund receipt.",
        409,
      );
    const parent = refund
      ? await tx.qboReceiptExport.findFirst({
          where: {
            sourceKey: "sale:" + input.orderId,
            mode: config.mode,
            realm: config.realm,
            status: "POSTED",
          },
        })
      : null;
    if (refund && (!parent || parent.reconciliationIssue))
      throw new AccountError(
        "Reconcile the original sale receipt in this company before preparing its refund.",
        409,
      );
    if (
      parent &&
      !isDeepStrictEqual(z.object({ sale: z.unknown() }).parse(parent.source).sale, sale)
    )
      throw new AccountError(
        "Original sale evidence differs from its posted receipt.",
        409,
      );
    const mapping = parent
      ? receiptExportMapping.parse(parent.mapping)
      : await currentReceiptMapping(tx, sale, config.mode, config.realm);
    const compilerMapping = receiptCompilerMapping(
      mapping,
      sale,
      config.mode,
      config.realm,
    );
    let payload: ReturnType<typeof prepareCashReceipt>;
    try {
      payload = prepareCashReceipt({
        documentNumber: (refund ? "DR" : "DS") + digest(id).slice(0, 19),
        sale,
        ...(refund ? { refund } : {}),
        mapping: compilerMapping,
      });
    } catch {
      throw new AccountError(
        "Original receipt amounts, tax evidence or product treatment require review.",
        409,
      );
    }
    const created = await tx.qboReceiptExport.create({
      data: {
        id,
        orderId: input.orderId,
        adjustmentId: input.adjustmentId,
        parentSaleId: parent?.id,
        sourceKey,
        entity: payload.entity,
        mode: config.mode,
        realm: config.realm,
        docNumber: payload.payload.DocNumber,
        requestHash,
        source: json({ sale, refund }),
        mapping: json(mapping),
        payload: json(payload),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "quickbooks.receipt.prepared",
        entityType: "QboReceiptExport",
        entityId: id,
        afterJson: {
          orderId: input.orderId,
          realm: config.realm,
          docNumber: created.docNumber,
          cashCents: payload.cashCents,
        },
      },
    });
    return receiptExportView(created);
  });
}
export async function cancelQuickbooksReceiptDraft(actor: string, id: string) {
  idSchema.parse(id);
  await financeAccess(prisma, actor, true);
  const config = await quickbooksConfig();
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    const e = await tx.qboReceiptExport.findUnique({ where: { id } });
    if (!e || e.mode !== config.mode || e.realm !== config.realm)
      throw new AccountError("Receipt export not found in this company.", 404);
    await receiptOrderLock(tx, e.orderId);
    const current = await tx.qboReceiptExport.findUniqueOrThrow({ where: { id } });
    if (current.status === "CANCELED") return { canceled: true };
    if (current.status !== "DRAFT")
      throw new AccountError(
        "A submitted receipt must be reconciled and cannot be canceled here.",
        409,
      );
    await tx.qboReceiptExport.update({ where: { id }, data: { status: "CANCELED" } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "quickbooks.receipt.canceled",
        entityType: "QboReceiptExport",
        entityId: id,
      },
    });
    return { canceled: true };
  });
}
