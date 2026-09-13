import { createHash } from "node:crypto";
import { Prisma, type QboTipJournal } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "@/lib/commerce/domain";
import { businessDate } from "@/lib/domain/operations";
import { tipAccounting } from "@/lib/domain/tip-accounting";
import {
  compileTipJournal,
  emptyTipBalances,
  matchTipJournal,
  tipJournalBalances,
  tipJournalMapping,
  tipAccountKeys,
} from "@/lib/domain/tip-journal";
import { tipAccountingSource, observeTipRefunds } from "./tip-accounting-source";
import { tipRefundTaxAllocations, assertTipTaxCorrections } from "./tip-refund-tax";
import { tipRefundRequestHold } from "./tip-refunds";
import { financeAccess } from "./finance";
import {
  authorizedQuickbooks,
  assertQuickbooksSnapshot,
  refreshQuickbooksWorker,
} from "./quickbooks-connection";
import {
  quickbooksConfig,
  readQuickbooksAccount,
  createQuickbooksCostJournal,
  findQuickbooksCostJournal,
} from "@/lib/integrations/quickbooks-client";
import {
  type QuickbooksActor,
  quickbooksAccountingAccess,
  quickbooksAuditActor,
  quickbooksWorkerAuthority,
} from "./quickbooks-worker-authority";
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const digest = (v: unknown) =>
  createHash("sha256")
    .update(
      canonicalJson(
        JSON.parse(
          JSON.stringify(v, (k, value) =>
            ["updatedAt", "recoveryCheckedAt"].includes(k) ? undefined : value,
          ),
        ),
      ),
    )
    .digest("hex");
const fail = () =>
  new AccountError("Tip accounting evidence changed or needs reconciliation.", 409);
const view = (r: QboTipJournal) => ({
  id: r.id,
  tipId: r.tipId,
  sequence: r.sequence,
  status: r.status,
  docNumber: r.docNumber,
  externalId: r.externalId,
  balances: r.balances,
  payload: r.payload,
  mapping: r.mapping,
  reconciliationIssue: r.reconciliationIssue,
});
async function localSource(tx: Prisma.TransactionClient, tipId: string) {
  const { tip, driver } = await tipAccountingSource(tx, tipId);
  const entries = await tx.tipPayoutEntry.findMany({
    where: { tipId },
    orderBy: { id: "asc" },
  });
  // Payouts must retain their permanent original transfer proof.
  for (const e of entries) {
    const audits = await tx.auditLog.findMany({
      where: {
        entityType: "TipPayoutEntry",
        entityId: e.id,
        action: "delivery.tip.payout.recorded",
      },
      take: 2,
    });
    const p = audits[0]?.afterJson as Record<string, unknown> | undefined;
    if (
      audits.length !== 1 ||
      audits[0].actorUserId !== e.actorUserId ||
      p?.id !== e.id ||
      p.tipId !== tipId ||
      p.amountCents !== e.amountCents ||
      p.kind !== e.kind ||
      p.reference !== e.reference ||
      p.requestHash !== e.requestHash ||
      p.driverUserId !== driver ||
      p.paidOn !== e.paidOn ||
      p.reversalOfId !== e.reversalOfId
    )
      throw fail();
  }
  const requests = await tx.tipRefundRequest.findMany({
    where: { tipId },
    orderBy: { id: "asc" },
    take: 101,
  });
  const allocations = await tipRefundTaxAllocations(tx, tip);
  return { tip, driver, entries, requests, allocations };
}
async function checkedSource(tipId: string) {
  const local = await localSource(prisma, tipId),
    observed = await observeTipRefunds(local.tip);
  const a = tipAccounting(
    local.tip.amountCents,
    local.tip.totalCents!,
    observed.refunds,
    local.entries,
    local.allocations,
  );
  if (
    a.review ||
    observed.disputed ||
    a.refundedTipCents === null ||
    (await tipRefundRequestHold(prisma, local.requests, observed.refunds))
  )
    throw fail();
  // Tax liability must use actual tax-report evidence, including full refunds.
  if (
    observed.refunds.some(
      (r) =>
        r.status === "succeeded" &&
        !local.allocations.some((v) => v.providerRefundId === r.id),
    )
  )
    throw fail();
  await assertTipTaxCorrections(prisma, local.tip, observed.refunds, local.allocations);
  return {
    local,
    observed,
    balances: tipJournalBalances(
      local.tip.totalCents!,
      local.tip.amountCents,
      a.refundedCashCents,
      a.refundedTipCents,
      a.paidCents,
    ),
  };
}
async function accounts(
  snapshot: Awaited<ReturnType<typeof authorizedQuickbooks>>,
  raw: unknown,
) {
  const m = tipJournalMapping.parse(raw);
  for (const k of tipAccountKeys) {
    const a = await readQuickbooksAccount(snapshot.config, snapshot.accessToken, m[k]);
    const expected =
      k === "collectionBank" || k === "payoutBank"
        ? "Bank"
        : k === "driverReceivable"
          ? "Other Current Asset"
          : "Other Current Liability";
    if (
      a.Id !== m[k] ||
      !a.Active ||
      a.CurrencyRef?.value !== "USD" ||
      a.AccountType !== expected
    )
      throw new AccountError(
        "Choose active USD bank, liability and driver-receivable accounts.",
        409,
      );
  }
  return m;
}
const postingAllowed = (mode: string, realm: string) =>
  process.env.DD_QBO_TIP_POSTING_ENABLED === "true" &&
  process.env.DD_QBO_TIP_POSTING_COMPANY === mode + ":" + realm;
export async function readQuickbooksTipJournals(actor: string, tipId: string) {
  z.string().min(1).max(100).parse(tipId);
  const canWrite = await financeAccess(prisma, actor);
  const c = await quickbooksConfig();
  const rows = await prisma.qboTipJournal.findMany({
    where: { tipId, mode: c.mode, realm: c.realm },
    orderBy: { sequence: "desc" },
    take: 100,
  });
  return { canWrite, canSubmit: postingAllowed(c.mode, c.realm), rows: rows.map(view) };
}
export async function prepareQuickbooksTipJournal(actor: string, raw: unknown) {
  const d = z
    .object({
      tipId: z.string().min(1).max(100),
      requestKey: z.uuid(),
      mapping: tipJournalMapping,
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const snapshot = await authorizedQuickbooks(actor),
    mapping = await accounts(snapshot, d.mapping),
    checked = await checkedSource(d.tipId);
  if ((snapshot.config.mode === "live") !== checked.local.tip.livemode) throw fail();
  const id = "qbt_" + digest(actor + ":" + d.requestKey),
    hash = digest(d);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    await tx.$queryRaw`SELECT id FROM "DeliveryTip" WHERE id=${d.tipId} FOR UPDATE`;
    const prior = await tx.qboTipJournal.findUnique({ where: { id } });
    if (prior) {
      if (
        prior.requestHash !== hash ||
        prior.mode !== snapshot.config.mode ||
        prior.realm !== snapshot.config.realm
      )
        throw fail();
      return view(prior);
    }
    if (digest(await localSource(tx, d.tipId)) !== digest(checked.local)) throw fail();
    const history = await tx.qboTipJournal.findMany({
      where: { tipId: d.tipId },
      orderBy: { sequence: "desc" },
      take: 1001,
    });
    if (
      history.length > 1000 ||
      history.some(
        (r) => !["POSTED", "CANCELED"].includes(r.status) || r.reconciliationIssue,
      )
    )
      throw new AccountError("Reconcile or cancel the previous tip journal first.", 409);
    const parent = history.find((r) => r.status === "POSTED");
    if (
      parent &&
      (parent.mode !== snapshot.config.mode ||
        parent.realm !== snapshot.config.realm ||
        digest(parent.mapping) !== digest(mapping))
    )
      throw new AccountError(
        "Keep this tip in its original accounting company and accounts.",
        409,
      );
    if (parent) await preparedProof(tx, parent);
    const payload = compileTipJournal(
      parent?.balances ?? emptyTipBalances,
      checked.balances,
      mapping,
      "DT" + digest(id).slice(0, 19),
      businessDate(),
    );
    if (!payload)
      throw new AccountError(
        "Tip balances are already posted. No adjusting entry is needed.",
        409,
      );
    const row = await tx.qboTipJournal.create({
      data: {
        id,
        tipId: d.tipId,
        sequence: (history[0]?.sequence ?? 0) + 1,
        mode: snapshot.config.mode,
        realm: snapshot.config.realm,
        requestHash: hash,
        docNumber: payload.DocNumber,
        source: json(checked),
        balances: json(checked.balances),
        mapping: json(mapping),
        payload: json(payload),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: quickbooksAuditActor(actor),
        entityType: "QboTipJournal",
        entityId: id,
        action: "quickbooks.tip.prepared",
        afterJson: json({
          sourceHash: digest(checked),
          payloadHash: digest(payload),
          mappingHash: digest(mapping),
          parentId: parent?.id ?? null,
        }),
      },
    });
    return view(row);
  });
}
async function preparedProof(tx: Prisma.TransactionClient, current: QboTipJournal) {
  const proofs = await tx.auditLog.findMany({
    where: {
      entityType: "QboTipJournal",
      entityId: current.id,
      action: "quickbooks.tip.prepared",
    },
    take: 2,
  });
  const proof = proofs[0]?.afterJson as Record<string, unknown> | undefined;
  if (
    proofs.length !== 1 ||
    proof?.sourceHash !== digest(current.source) ||
    proof.payloadHash !== digest(current.payload) ||
    proof.mappingHash !== digest(current.mapping) ||
    digest((current.source as { balances: unknown }).balances) !==
      digest(current.balances)
  )
    throw fail();
}
async function confirm(
  actor: QuickbooksActor,
  id: string,
  raw: unknown,
  snapshot: Awaited<ReturnType<typeof authorizedQuickbooks>>,
) {
  if ((await quickbooksConfig()).fingerprint !== snapshot.config.fingerprint)
    throw fail();
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    const r = await tx.qboTipJournal.findUniqueOrThrow({ where: { id } });
    await tx.$queryRaw`SELECT id FROM "DeliveryTip" WHERE id=${r.tipId} FOR UPDATE`;
    const current = await tx.qboTipJournal.findUniqueOrThrow({ where: { id } });
    if (
      current.mode !== snapshot.config.mode ||
      current.realm !== snapshot.config.realm ||
      !["SUBMITTING", "UNKNOWN", "POSTED"].includes(current.status)
    )
      throw fail();
    const externalId = matchTipJournal(raw, current.payload);
    if (current.externalId && current.externalId !== externalId) throw fail();
    await preparedProof(tx, current);
    const saved = await tx.qboTipJournal.update({
      where: { id },
      data: {
        status: "POSTED",
        externalId,
        confirmedAt: current.confirmedAt ?? new Date(),
        reconciliationIssue: null,
      },
    });
    if (current.status !== "POSTED")
      await tx.auditLog.create({
        data: {
          actorUserId: quickbooksAuditActor(actor),
          entityType: "QboTipJournal",
          entityId: id,
          action: "quickbooks.tip.confirmed",
          afterJson: { externalId, realm: current.realm, mode: current.mode },
        },
      });
    return view(saved);
  });
}
async function actAs(actor: QuickbooksActor, raw: unknown) {
  const d = z
    .object({
      id: z.string().min(1).max(100),
      action: z.enum(["SUBMIT", "RECONCILE", "CANCEL"]),
    })
    .strict()
    .parse(raw);
  await quickbooksAccountingAccess(prisma, actor, true);
  const snapshot = await authorizedQuickbooks(actor);
  const first = await prisma.qboTipJournal.findUnique({ where: { id: d.id } });
  if (
    !first ||
    first.mode !== snapshot.config.mode ||
    first.realm !== snapshot.config.realm
  )
    throw new AccountError("Tip journal not found.", 404);
  if (d.action === "RECONCILE") {
    if (!["SUBMITTING", "UNKNOWN", "POSTED"].includes(first.status)) throw fail();
    try {
      const found = await findQuickbooksCostJournal(
        snapshot.config,
        snapshot.accessToken,
        first.docNumber,
      );
      if (found.length !== 1) throw fail();
      return await confirm(actor, first.id, found[0], snapshot);
    } catch (e) {
      await prisma.qboTipJournal.update({
        where: { id: first.id },
        data: { reconciliationIssue: "EVIDENCE_UNCONFIRMED" },
      });
      throw e;
    }
  }
  if (typeof actor !== "string") throw fail();
  if (d.action === "SUBMIT" && first.status !== "DRAFT") return view(first);
  const checked = d.action === "SUBMIT" ? await checkedSource(first.tipId) : null;
  if (checked) {
    await accounts(snapshot, first.mapping);
    if (digest(checked) !== digest(first.source))
      throw new AccountError(
        "Tip activity changed. Cancel this unused draft and prepare a fresh one.",
        409,
      );
  }
  const claimed = await prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    await tx.$queryRaw`SELECT id FROM "DeliveryTip" WHERE id=${first.tipId} FOR UPDATE`;
    const r = await tx.qboTipJournal.findUniqueOrThrow({ where: { id: first.id } });
    if (r.status !== "DRAFT") {
      if (d.action === "CANCEL") throw fail();
      return null;
    }
    if (d.action === "SUBMIT") {
      await preparedProof(tx, r);
      if (!postingAllowed(r.mode, r.realm))
        throw new AccountError(
          "Tip accounting posting is not activated for this company.",
          409,
        );
      if (digest(await localSource(tx, r.tipId)) !== digest(checked!.local)) throw fail();
    }
    const saved = await tx.qboTipJournal.update({
      where: { id: r.id },
      data: {
        status: d.action === "CANCEL" ? "CANCELED" : "SUBMITTING",
        ...(d.action === "SUBMIT" ? { submittedAt: new Date() } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: quickbooksAuditActor(actor),
        entityType: "QboTipJournal",
        entityId: r.id,
        action: "quickbooks.tip." + d.action.toLowerCase(),
        afterJson: { status: saved.status },
      },
    });
    return saved;
  });
  if (!claimed)
    return view(
      await prisma.qboTipJournal.findUniqueOrThrow({ where: { id: first.id } }),
    );
  if (d.action === "CANCEL") return view(claimed);
  try {
    return await confirm(
      actor,
      claimed.id,
      await createQuickbooksCostJournal(
        snapshot.config,
        snapshot.accessToken,
        claimed.payload,
      ),
      snapshot,
    );
  } catch {
    await prisma.qboTipJournal.updateMany({
      where: { id: claimed.id, status: "SUBMITTING" },
      data: { status: "UNKNOWN", reconciliationIssue: "EVIDENCE_UNCONFIRMED" },
    });
    throw new AccountError(
      "Posting outcome is uncertain. Reconcile this journal; do not submit another.",
      503,
    );
  }
}

export function actQuickbooksTipJournal(actor: string, raw: unknown) {
  return actAs(actor, raw);
}
export async function reconcileScheduledQuickbooksTips(
  ownsLease: () => Promise<boolean>,
) {
  if (!(await ownsLease())) throw Error("Worker lease expired.");
  await refreshQuickbooksWorker();
  const { config } = await authorizedQuickbooks(quickbooksWorkerAuthority);
  const company = { mode: config.mode, realm: config.realm };
  const rows = await prisma.qboTipJournal.findMany({
    where: {
      ...company,
      status: { in: ["SUBMITTING", "UNKNOWN", "POSTED"] },
      OR: [
        { recoveryCheckedAt: null },
        { recoveryCheckedAt: { lt: new Date(Date.now() - 60000) } },
      ],
    },
    orderBy: [{ recoveryCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: 10,
  });
  let completed = 0;
  for (const r of rows) {
    if (!(await ownsLease())) throw Error("Worker lease expired.");
    await prisma.qboTipJournal.update({
      where: { id: r.id },
      data: { recoveryCheckedAt: new Date() },
    });
    try {
      await actAs(quickbooksWorkerAuthority, { id: r.id, action: "RECONCILE" });
      completed++;
    } catch {
      /* retained for provider-read recovery */
    }
  }
  const attention = await prisma.qboTipJournal.count({
    where: {
      ...company,
      OR: [
        { status: { in: ["SUBMITTING", "UNKNOWN"] } },
        { reconciliationIssue: { not: null } },
      ],
    },
  });
  return { checked: rows.length, completed, attention };
}
