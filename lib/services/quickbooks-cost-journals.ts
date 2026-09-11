import {
  type QuickbooksActor,
  quickbooksAccountingAccess,
  quickbooksAuditActor,
  quickbooksWorkerAuthority,
} from "./quickbooks-worker-authority";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type QboCostExport } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { financeAccess } from "./finance";
import {
  authorizedQuickbooks,
  assertQuickbooksSnapshot,
  refreshQuickbooksWorker,
} from "./quickbooks-connection";
import { costMappingSchema } from "@/lib/domain/quickbooks-cost";
import {
  quickbooksConfig,
  readQuickbooksAccount,
  createQuickbooksCostJournal,
  findQuickbooksCostJournal,
} from "@/lib/integrations/quickbooks-client";
import {
  journalSource,
  journalPayload,
  matchCostJournal,
} from "@/lib/domain/quickbooks-journal";
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
import { recordedOrderCost } from "./quickbooks-cost-source";
import { costMappingKey } from "./quickbooks-cost-mapping";
const publicExport = (e: QboCostExport) => ({
  id: e.id,
  status: e.status,
  realm: e.realm,
  docNumber: e.docNumber,
  source: journalSource.parse(e.source),
  mapping: costMappingSchema.parse(e.mapping),
  externalId: e.externalId,
  reconciliationIssue: e.reconciliationIssue,
  recoveryCheckedAt: e.recoveryCheckedAt?.toISOString() ?? null,
  submittedAt: e.submittedAt?.toISOString() ?? null,
  confirmedAt: e.confirmedAt?.toISOString() ?? null,
});
async function orderLock(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
}
function postingAllowed(mode: string, realm: string) {
  return (
    process.env.DD_QBO_COST_POSTING_ENABLED === "true" &&
    process.env.DD_QBO_COST_POSTING_COMPANY === mode + ":" + realm
  );
}
export async function listQuickbooksCostJournals(actor: string, cursor?: string) {
  z.string().min(1).max(100).optional().parse(cursor);
  const canWrite = await financeAccess(prisma, actor);
  const config = await quickbooksConfig();
  const canSubmit = postingAllowed(config.mode, config.realm);
  const rows = await prisma.qboCostExport.findMany({
    where: { mode: config.mode, realm: config.realm },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return {
    canWrite,
    canSubmit,
    nextCursor: rows.length > 50 ? rows[49].id : null,
    rows: rows.slice(0, 50).map(publicExport),
  };
}
export async function prepareQuickbooksCostJournal(actor: string, raw: unknown) {
  const input = z
    .object({
      requestKey: z.uuid(),
      orderId: z.string().min(1).max(100),
      returnId: z.string().min(1).max(100).optional(),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const config = await quickbooksConfig(),
    id = "qbc_" + digest(actor + ":" + input.requestKey),
    requestHash = digest(JSON.stringify(input));
  const previous = await prisma.qboCostExport.findUnique({ where: { id } });
  if (previous) {
    if (
      previous.requestHash !== requestHash ||
      previous.mode !== config.mode ||
      previous.realm !== config.realm
    )
      throw new AccountError(
        "This preparation request was already used for different choices.",
        409,
      );
    return publicExport(previous);
  }
  const snapshot = await authorizedQuickbooks(actor);
  if (config.fingerprint !== snapshot.config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    await orderLock(tx, input.orderId);
    const prior = await tx.qboCostExport.findUnique({ where: { id } });
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new AccountError("Preparation request changed.", 409);
      return publicExport(prior);
    }
    const sourceKey = input.returnId
      ? "return:" + input.returnId
      : "sale:" + input.orderId;
    if (
      await tx.qboCostExport.findFirst({
        where: { sourceKey, status: { not: "CANCELED" } },
      })
    )
      throw new AccountError(
        "This cost source already has an export. Review it before preparing another.",
        409,
      );
    const reviewed = await recordedOrderCost(tx, input.orderId, input.returnId);
    if (reviewed.amountCents === 0)
      throw new AccountError(
        "This source has no cost to post. No journal is needed.",
        409,
      );
    const savedSource = journalSource.parse(reviewed);
    const parent = input.returnId
      ? await tx.qboCostExport.findFirst({
          where: {
            sourceKey: "sale:" + input.orderId,
            status: "POSTED",
            mode: config.mode,
            realm: config.realm,
          },
        })
      : null;
    if (input.returnId && (!parent || parent.reconciliationIssue))
      throw new AccountError(
        "Reconcile the original sale cost in this company before exporting its return.",
        409,
      );
    if (
      parent &&
      !isDeepStrictEqual(parent.source, await recordedOrderCost(tx, input.orderId))
    )
      throw new AccountError(
        "Original sale cost evidence changed. Review it before exporting returns.",
        409,
      );
    const row = parent
      ? null
      : await tx.setting.findUnique({
          where: { key: costMappingKey(config.mode, config.realm) },
        });
    if (!parent && !row)
      throw new AccountError("Map the cost and inventory accounts first.", 409);
    const mapping = costMappingSchema.parse(parent?.mapping ?? row!.valueJson);
    if (mapping.mode !== config.mode || mapping.realm !== config.realm)
      throw new AccountError("Accounting company does not match.", 409);
    const debit = input.returnId ? mapping.inventoryAccount.id : mapping.costAccount.id;
    const credit = input.returnId ? mapping.costAccount.id : mapping.inventoryAccount.id;
    const payload = journalPayload.parse({
      DocNumber: "DC" + digest(id).slice(0, 19),
      TxnDate: savedSource.date,
      CurrencyRef: { value: "USD" },
      Line: [
        {
          Amount: savedSource.amountCents / 100,
          Description:
            "DetergentsDelivered " +
            savedSource.kind.toLowerCase() +
            " cost " +
            digest(sourceKey).slice(0, 16),
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: debit } },
        },
        {
          Amount: savedSource.amountCents / 100,
          Description:
            "DetergentsDelivered " +
            savedSource.kind.toLowerCase() +
            " cost " +
            digest(sourceKey).slice(0, 16),
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Credit",
            AccountRef: { value: credit },
          },
        },
      ],
    });
    const created = await tx.qboCostExport.create({
      data: {
        id,
        orderId: input.orderId,
        returnId: input.returnId,
        parentSaleId: parent?.id,
        sourceKey,
        mode: config.mode,
        realm: config.realm,
        docNumber: payload.DocNumber,
        requestHash,
        source: json(savedSource),
        mapping: json(mapping),
        payload: json(payload),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "quickbooks.cost.prepared",
        entityType: "QboCostExport",
        entityId: id,
        afterJson: {
          orderId: input.orderId,
          realm: config.realm,
          docNumber: payload.DocNumber,
        },
      },
    });
    return publicExport(created);
  });
}
export async function cancelQuickbooksCostJournal(actor: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    const e = await tx.qboCostExport.findUnique({ where: { id } });
    if (!e) throw new AccountError("Export not found.", 404);
    await orderLock(tx, e.orderId);
    const current = await tx.qboCostExport.findUniqueOrThrow({ where: { id } });
    if (current.status === "CANCELED") return { canceled: true };
    if (current.status !== "DRAFT")
      throw new AccountError(
        "A submitted export must be reconciled; it cannot be canceled here.",
        409,
      );
    await tx.qboCostExport.update({ where: { id }, data: { status: "CANCELED" } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "quickbooks.cost.canceled",
        entityType: "QboCostExport",
        entityId: id,
      },
    });
    return { canceled: true };
  });
}
async function confirm(
  actor: QuickbooksActor,
  id: string,
  receipt: unknown,
  snapshot: Awaited<ReturnType<typeof authorizedQuickbooks>>,
) {
  if ((await quickbooksConfig()).fingerprint !== snapshot.config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    const first = await tx.qboCostExport.findUniqueOrThrow({ where: { id } });
    await orderLock(tx, first.orderId);
    const record = await tx.qboCostExport.findUniqueOrThrow({ where: { id } });
    const externalId = matchCostJournal(receipt, record.payload);
    if (record.mode !== snapshot.config.mode || record.realm !== snapshot.config.realm)
      throw new AccountError("Accounting company does not match.", 409);
    if (record.status === "POSTED") {
      if (record.externalId !== externalId)
        throw new AccountError("Accounting evidence changed.", 409);
      return publicExport(record);
    }
    if (!["SUBMITTING", "UNKNOWN"].includes(record.status))
      throw new AccountError("Export is not awaiting confirmation.", 409);
    const currentSource = await recordedOrderCost(
      tx,
      record.orderId,
      record.returnId ?? undefined,
    );
    if (!isDeepStrictEqual(currentSource, record.source))
      throw new AccountError(
        "Original cost evidence changed and needs accounting review.",
        409,
      );
    const posted = await tx.qboCostExport.update({
      where: { id },
      data: { status: "POSTED", externalId, confirmedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: quickbooksAuditActor(actor),
        action: "quickbooks.cost.confirmed",
        entityType: "QboCostExport",
        entityId: id,
        afterJson: {
          externalId,
          realm: record.realm,
          source: typeof actor === "string" ? "staff" : "scheduled",
        },
      },
    });
    return publicExport(posted);
  });
}
export async function submitQuickbooksCostJournal(actor: string, id: string) {
  await financeAccess(prisma, actor, true);
  const snapshot = await authorizedQuickbooks(actor),
    config = snapshot.config;
  if (!postingAllowed(config.mode, config.realm))
    throw new AccountError("Cost journal posting is not enabled for this company.", 409);
  const before = await prisma.qboCostExport.findUnique({ where: { id } });
  if (!before) throw new AccountError("Export not found.", 404);
  if (before.mode !== config.mode || before.realm !== config.realm)
    throw new AccountError("Accounting company does not match.", 409);
  if (before.status !== "DRAFT") return publicExport(before);
  const mapping = costMappingSchema.parse(before.mapping);
  const [expense, payment] = await Promise.all([
    readQuickbooksAccount(config, snapshot.accessToken, mapping.costAccount.id),
    readQuickbooksAccount(config, snapshot.accessToken, mapping.inventoryAccount.id),
  ]);
  if (
    !expense.Active ||
    !payment.Active ||
    expense.Id !== mapping.costAccount.id ||
    payment.Id !== mapping.inventoryAccount.id ||
    expense.AccountType !== mapping.costAccount.type ||
    payment.AccountType !== mapping.inventoryAccount.type ||
    expense.CurrencyRef?.value !== "USD" ||
    payment.CurrencyRef?.value !== "USD"
  )
    throw new AccountError(
      "Mapped accounts changed. Cancel this draft and review its mapping.",
      409,
    );
  if ((await quickbooksConfig()).fingerprint !== config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  const claim = await prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    await orderLock(tx, before.orderId);
    const current = await tx.qboCostExport.findUniqueOrThrow({ where: { id } });
    if (current.status !== "DRAFT") return null;
    const currentSource = await recordedOrderCost(
      tx,
      current.orderId,
      current.returnId ?? undefined,
    );
    if (!isDeepStrictEqual(currentSource, current.source))
      throw new AccountError("Original cost evidence changed.", 409);
    if (current.parentSaleId) {
      const parent = await tx.qboCostExport.findUniqueOrThrow({
        where: { id: current.parentSaleId },
      });
      if (
        parent.status !== "POSTED" ||
        parent.reconciliationIssue ||
        !isDeepStrictEqual(parent.source, await recordedOrderCost(tx, current.orderId)) ||
        !isDeepStrictEqual(parent.mapping, mapping)
      )
        throw new AccountError("Original sale cost needs accounting review.", 409);
    } else {
      const row = await tx.setting.findUnique({
        where: { key: costMappingKey(config.mode, config.realm) },
      });
      if (!row || !isDeepStrictEqual(costMappingSchema.parse(row.valueJson), mapping))
        throw new AccountError(
          "Cost mapping changed. Cancel and prepare a fresh draft.",
          409,
        );
    }
    await tx.qboCostExport.update({
      where: { id },
      data: { status: "SUBMITTING", submittedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "quickbooks.cost.submitting",
        entityType: "QboCostExport",
        entityId: id,
      },
    });
    return current;
  });
  if (!claim)
    return publicExport(await prisma.qboCostExport.findUniqueOrThrow({ where: { id } }));
  try {
    return await confirm(
      actor,
      id,
      await createQuickbooksCostJournal(config, snapshot.accessToken, claim.payload),
      snapshot,
    );
  } catch {
    await prisma.qboCostExport.updateMany({
      where: { id, status: "SUBMITTING" },
      data: { status: "UNKNOWN" },
    });
    throw new AccountError(
      "Submission was not confirmed. Reconcile this export; do not create another transaction.",
      503,
    );
  }
}
async function reconcileAs(actor: QuickbooksActor, id: string) {
  await quickbooksAccountingAccess(prisma, actor, true);
  const snapshot = await authorizedQuickbooks(actor),
    record = await prisma.qboCostExport.findUnique({ where: { id } });
  if (!record) throw new AccountError("Export not found.", 404);
  if (record.mode !== snapshot.config.mode || record.realm !== snapshot.config.realm)
    throw new AccountError("Accounting company does not match.", 409);
  if (!["SUBMITTING", "UNKNOWN", "POSTED"].includes(record.status))
    throw new AccountError("This export has not been submitted.", 409);
  const matches = await findQuickbooksCostJournal(
    snapshot.config,
    snapshot.accessToken,
    record.docNumber,
  );
  if (matches.length !== 1)
    throw new AccountError(
      "A unique matching QuickBooks cost journal was not found. Keep this export blocked for accounting review.",
      409,
    );
  const result = await confirm(actor, id, matches[0], snapshot);
  await prisma.qboCostExport.update({
    where: { id },
    data: { reconciliationIssue: null, recoveryCheckedAt: new Date() },
  });
  return result;
}

export function reconcileQuickbooksCostJournal(actor: string, id: string) {
  return reconcileAs(actor, id);
}

export async function reconcileScheduledQuickbooksCostJournals(
  ownsLease: () => Promise<boolean>,
) {
  if (!(await ownsLease())) throw new Error("Worker lease expired.");
  await refreshQuickbooksWorker();
  const snapshot = await authorizedQuickbooks(quickbooksWorkerAuthority);
  const company = { mode: snapshot.config.mode, realm: snapshot.config.realm };
  const now = new Date();
  const rows = await prisma.qboCostExport.findMany({
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
    await prisma.qboCostExport.update({
      where: { id: row.id },
      data: { recoveryCheckedAt: new Date() },
    });
    try {
      await reconcileAs(quickbooksWorkerAuthority, row.id);
      await prisma.qboCostExport.update({
        where: { id: row.id },
        data: { reconciliationIssue: null },
      });
      completed++;
    } catch {
      await prisma.qboCostExport.update({
        where: { id: row.id },
        data: { reconciliationIssue: "EVIDENCE_UNCONFIRMED" },
      });
    }
  }
  const attention = await prisma.qboCostExport.count({
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
