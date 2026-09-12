import { isDeepStrictEqual } from "node:util";
import { Prisma, type QboReceiptExport } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { financeAccess } from "./finance";
import { matchCashReceipt } from "@/lib/domain/quickbooks-receipt";
import {
  quickbooksConfig,
  readQuickbooksAccount,
  readQuickbooksSalesEntity,
  readQuickbooksReceiptCompany,
  createQuickbooksCashReceipt,
  findQuickbooksCashReceipt,
} from "@/lib/integrations/quickbooks-client";
import {
  authorizedQuickbooks,
  assertQuickbooksSnapshot,
  refreshQuickbooksWorker,
} from "./quickbooks-connection";
import {
  type QuickbooksActor,
  quickbooksAccountingAccess,
  quickbooksAuditActor,
  quickbooksWorkerAuthority,
} from "./quickbooks-worker-authority";
import {
  receiptExportMapping,
  preparedReceiptSchema,
  receiptExportView,
  receiptOrderLock,
  receiptCompilerMapping,
  currentReceiptMapping,
  receiptPostingAllowed,
} from "./quickbooks-receipt-drafts";
import { recordedSaleSource, recordedRefundSource } from "./sales-refund-source";
const idSchema = z.string().min(1).max(100);
async function retainReceiptReadFailure(id: string) {
  // A transient read error cannot erase a known failed-refund correction obligation.
  await prisma.$transaction(async (tx) => {
    await tx.qboReceiptExport.update({
      where: { id },
      data: { recoveryCheckedAt: new Date() },
    });
    await tx.qboReceiptExport.updateMany({
      where: {
        id,
        OR: [
          { reconciliationIssue: null },
          { reconciliationIssue: { not: "REFUND_COMPENSATION_REVIEW" } },
        ],
      },
      data: { reconciliationIssue: "EVIDENCE_UNCONFIRMED" },
    });
  });
}
async function sourceEvidence(tx: Prisma.TransactionClient, e: QboReceiptExport) {
  const sale = await recordedSaleSource(tx, e.orderId),
    refund = e.adjustmentId
      ? await recordedRefundSource(tx, e.orderId, e.adjustmentId)
      : null;
  if (!isDeepStrictEqual({ sale, refund }, e.source))
    throw new AccountError("Original receipt evidence changed. Review this export.", 409);
  receiptCompilerMapping(e.mapping, sale, e.mode, e.realm);
  return sale;
}
async function refundCompensated(tx: Prisma.TransactionClient, e: QboReceiptExport) {
  if (!e.adjustmentId) return false;
  const a = await tx.refundAdjustment.findUniqueOrThrow({
    where: { id: e.adjustmentId },
    select: {
      request: {
        select: {
          status: true,
          adjustments: { where: { kind: "COMPENSATION" }, select: { id: true }, take: 1 },
        },
      },
    },
  });
  return (
    ["FAILED", "CANCELED"].includes(a.request.status) || a.request.adjustments.length > 0
  );
}
async function checkProviderMappings(
  snapshot: Awaited<ReturnType<typeof authorizedQuickbooks>>,
  raw: unknown,
) {
  const mapping = receiptExportMapping.parse(raw),
    config = snapshot.config,
    token = snapshot.accessToken;
  const [company, clearing, customer] = await Promise.all([
    readQuickbooksReceiptCompany(config, token),
    readQuickbooksAccount(config, token, mapping.settings.depositAccount.id),
    readQuickbooksSalesEntity(config, token, "customer", mapping.customer.externalId),
  ]);
  if (
    company.country !== "US" ||
    company.homeCurrency !== "USD" ||
    !company.usingSalesTax ||
    clearing.Id !== mapping.settings.depositAccount.id ||
    !clearing.Active ||
    clearing.AccountType !== "Bank" ||
    clearing.CurrencyRef?.value !== "USD" ||
    customer.kind !== "customer" ||
    customer.id !== mapping.customer.externalId ||
    !customer.active ||
    customer.currency !== "USD"
  )
    throw new AccountError(
      "Receipt company, clearing account or customer changed. Review the mapping.",
      409,
    );
  // Bound read concurrency; deduplicate shared income-account reads across items.
  const incomes = new Map<
    string,
    Promise<Awaited<ReturnType<typeof readQuickbooksAccount>>>
  >();
  for (let start = 0; start < mapping.items.length; start += 5) {
    await Promise.all(
      mapping.items.slice(start, start + 5).map(async (m) => {
        const item = await readQuickbooksSalesEntity(config, token, "item", m.externalId);
        if (
          item.kind !== "item" ||
          item.id !== m.externalId ||
          !item.active ||
          item.tracksQuantity ||
          !["NonInventory", "Service"].includes(item.type) ||
          !item.incomeAccountId ||
          item.incomeAccountId !== m.incomeAccountId
        )
          throw new AccountError(
            "A receipt item or its income account changed. Review the original mapping.",
            409,
          );
        if (!incomes.has(item.incomeAccountId))
          incomes.set(
            item.incomeAccountId,
            readQuickbooksAccount(config, token, item.incomeAccountId),
          );
        const income = await incomes.get(item.incomeAccountId)!;
        if (
          income.Id !== item.incomeAccountId ||
          !income.Active ||
          income.AccountType !== "Income" ||
          income.CurrencyRef?.value !== "USD"
        )
          throw new AccountError("The receipt income account requires review.", 409);
      }),
    );
  }
}
async function confirm(
  actor: QuickbooksActor,
  id: string,
  raw: unknown,
  snapshot: Awaited<ReturnType<typeof authorizedQuickbooks>>,
) {
  if ((await quickbooksConfig()).fingerprint !== snapshot.config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    const first = await tx.qboReceiptExport.findUniqueOrThrow({ where: { id } });
    await receiptOrderLock(tx, first.orderId);
    const current = await tx.qboReceiptExport.findUniqueOrThrow({ where: { id } });
    if (current.mode !== snapshot.config.mode || current.realm !== snapshot.config.realm)
      throw new AccountError("Accounting company changed.", 409);
    const externalId = matchCashReceipt(raw, current.payload);
    if (!["SUBMITTING", "UNKNOWN", "POSTED"].includes(current.status))
      throw new AccountError("Receipt is not awaiting provider evidence.", 409);
    if (current.status === "POSTED" && current.externalId !== externalId)
      throw new AccountError("Posted receipt identity changed.", 409);
    await sourceEvidence(tx, current);
    const issue = (await refundCompensated(tx, current))
      ? "REFUND_COMPENSATION_REVIEW"
      : null;
    const posted = await tx.qboReceiptExport.update({
      where: { id },
      data: {
        status: "POSTED",
        externalId,
        confirmedAt: current.confirmedAt ?? new Date(),
        reconciliationIssue: issue,
        recoveryCheckedAt: new Date(),
      },
    });
    if (current.status !== "POSTED")
      await tx.auditLog.create({
        data: {
          actorUserId: quickbooksAuditActor(actor),
          action: "quickbooks.receipt.confirmed",
          entityType: "QboReceiptExport",
          entityId: id,
          afterJson: {
            externalId,
            realm: current.realm,
            entity: current.entity,
            source: typeof actor === "string" ? "staff" : "scheduled",
          },
        },
      });
    return receiptExportView(posted);
  });
}
export async function submitQuickbooksReceipt(actor: string, id: string) {
  idSchema.parse(id);
  await financeAccess(prisma, actor, true);
  const snapshot = await authorizedQuickbooks(actor),
    config = snapshot.config;
  if (!receiptPostingAllowed(config.mode, config.realm))
    throw new AccountError("Receipt posting is not enabled for this company.", 409);
  const before = await prisma.qboReceiptExport.findUnique({ where: { id } });
  if (!before || before.mode !== config.mode || before.realm !== config.realm)
    throw new AccountError("Receipt export not found in this company.", 404);
  if (before.status !== "DRAFT") return receiptExportView(before);
  await checkProviderMappings(snapshot, before.mapping);
  if ((await quickbooksConfig()).fingerprint !== config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  const claim = await prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    await receiptOrderLock(tx, before.orderId);
    const current = await tx.qboReceiptExport.findUniqueOrThrow({ where: { id } });
    if (current.status !== "DRAFT") return null;
    if (!receiptPostingAllowed(config.mode, config.realm))
      throw new AccountError("Receipt posting was disabled.", 409);
    const sale = await sourceEvidence(tx, current);
    if (await refundCompensated(tx, current))
      throw new AccountError(
        "This refund failed or was compensated. Review it before exporting any accounting adjustment.",
        409,
      );
    if (current.parentSaleId) {
      const parent = await tx.qboReceiptExport.findUniqueOrThrow({
        where: { id: current.parentSaleId },
      });
      if (
        parent.status !== "POSTED" ||
        parent.reconciliationIssue ||
        parent.mode !== current.mode ||
        parent.realm !== current.realm ||
        !isDeepStrictEqual(parent.mapping, current.mapping) ||
        !isDeepStrictEqual(
          z.object({ sale: z.unknown() }).parse(parent.source).sale,
          sale,
        )
      )
        throw new AccountError("The original sale receipt needs reconciliation.", 409);
    } else if (
      !isDeepStrictEqual(
        await currentReceiptMapping(tx, sale, config.mode, config.realm),
        current.mapping,
      )
    )
      throw new AccountError(
        "Receipt mappings changed. Cancel and prepare a fresh draft.",
        409,
      );
    await tx.qboReceiptExport.update({
      where: { id },
      data: { status: "SUBMITTING", submittedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "quickbooks.receipt.submitting",
        entityType: "QboReceiptExport",
        entityId: id,
      },
    });
    return current;
  });
  if (!claim)
    return receiptExportView(
      await prisma.qboReceiptExport.findUniqueOrThrow({ where: { id } }),
    );
  try {
    const prepared = preparedReceiptSchema.parse(claim.payload);
    return await confirm(
      actor,
      id,
      await createQuickbooksCashReceipt(
        config,
        snapshot.accessToken,
        prepared.entity,
        prepared.payload,
      ),
      snapshot,
    );
  } catch {
    await prisma.qboReceiptExport.updateMany({
      where: { id, status: "SUBMITTING" },
      data: { status: "UNKNOWN" },
    });
    await retainReceiptReadFailure(id);
    throw new AccountError(
      "Receipt submission was not confirmed. Reconcile this export before any further accounting action.",
      503,
    );
  }
}
async function reconcileAs(actor: QuickbooksActor, id: string) {
  idSchema.parse(id);
  await quickbooksAccountingAccess(prisma, actor, true);
  const snapshot = await authorizedQuickbooks(actor),
    record = await prisma.qboReceiptExport.findUnique({ where: { id } });
  if (
    !record ||
    record.mode !== snapshot.config.mode ||
    record.realm !== snapshot.config.realm
  )
    throw new AccountError("Receipt export not found in this company.", 404);
  if (!["SUBMITTING", "UNKNOWN", "POSTED"].includes(record.status))
    throw new AccountError("This receipt has not been submitted.", 409);
  const prepared = preparedReceiptSchema.parse(record.payload);
  try {
    const matches = await findQuickbooksCashReceipt(
      snapshot.config,
      snapshot.accessToken,
      prepared.entity,
      record.docNumber,
    );
    if (matches.length !== 1)
      throw new AccountError(
        "A unique matching receipt was not found. Keep this export blocked for review.",
        409,
      );
    return await confirm(actor, id, matches[0], snapshot);
  } catch (e) {
    await retainReceiptReadFailure(id);
    throw e;
  }
}
export function reconcileQuickbooksReceipt(actor: string, id: string) {
  return reconcileAs(actor, id);
}
export async function reconcileScheduledQuickbooksReceipts(
  ownsLease: () => Promise<boolean>,
) {
  if (!(await ownsLease())) throw new Error("Worker lease expired.");
  await refreshQuickbooksWorker();
  const snapshot = await authorizedQuickbooks(quickbooksWorkerAuthority),
    company = { mode: snapshot.config.mode, realm: snapshot.config.realm },
    now = new Date();
  const rows = await prisma.qboReceiptExport.findMany({
    where: {
      ...company,
      OR: [
        {
          status: { in: ["SUBMITTING", "UNKNOWN"] },
          OR: [
            { recoveryCheckedAt: null },
            { recoveryCheckedAt: { lt: new Date(now.getTime() - 60000) } },
          ],
        },
        {
          status: "POSTED",
          OR: [
            { recoveryCheckedAt: null },
            { recoveryCheckedAt: { lt: new Date(now.getTime() - 86400000) } },
          ],
        },
      ],
    },
    orderBy: [{ recoveryCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: 10,
  });
  let completed = 0;
  for (const row of rows) {
    if (!(await ownsLease())) throw new Error("Worker lease expired.");
    await prisma.qboReceiptExport.update({
      where: { id: row.id },
      data: { recoveryCheckedAt: new Date() },
    });
    try {
      await reconcileAs(quickbooksWorkerAuthority, row.id);
      completed++;
    } catch {
      await retainReceiptReadFailure(row.id);
    }
  }
  const attention = await prisma.qboReceiptExport.count({
    where: {
      ...company,
      OR: [
        { reconciliationIssue: { not: null } },
        { status: { in: ["SUBMITTING", "UNKNOWN"] } },
      ],
    },
  });
  return { checked: rows.length, completed, attention };
}
