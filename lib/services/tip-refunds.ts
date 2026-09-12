import { createHash } from "node:crypto";
import type { Prisma, TipRefundRequest } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "@/lib/commerce/domain";
import { readCommerce } from "@/lib/commerce/runtime";
import {
  submitClaimedStripeTipRefund,
  type RefundObservation,
} from "@/lib/commerce/refund-provider";
import { financeAccess } from "./finance";
import { tipAccountingSource, observeTipRefunds } from "./tip-accounting-source";
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const fail = () =>
  new AccountError(
    "Tip refund requires reconciliation before another refund or payout.",
    409,
  );
const unresolved = ["SUBMITTING", "UNKNOWN", "PENDING"];
function match(r: TipRefundRequest, o: RefundObservation) {
  if (
    (r.providerRefundId && r.providerRefundId !== o.id) ||
    o.requestId !== r.id ||
    o.requestHash !== r.requestHash ||
    o.project !== "detergents-delivered" ||
    o.amountCents !== r.amountCents ||
    o.currency !== r.currency
  )
    throw fail();
}
function state(o: RefundObservation) {
  if (o.status === "succeeded") return o.balanceTransactionId ? "SUCCEEDED" : "UNKNOWN";
  if (o.status === "failed" || o.status === "canceled")
    return o.balanceTransactionId && !o.failureBalanceTransactionId
      ? "UNKNOWN"
      : o.status.toUpperCase();
  return "PENDING";
}
const dto = (r: TipRefundRequest) => ({
  id: r.id,
  state: r.state,
  amountCents: r.amountCents,
  providerRefundId: r.providerRefundId,
  createdAt: r.createdAt,
  lastError: r.lastError,
});
async function saveObservation(
  tx: Prisma.TransactionClient,
  request: TipRefundRequest,
  o: RefundObservation,
  actor: string | null,
) {
  match(request, o);
  const next = state(o);
  const saved = await tx.tipRefundRequest.update({
    where: { id: request.id },
    data: {
      state: next,
      providerRefundId: o.id,
      recoveryCheckedAt: new Date(),
      lastError: next === "UNKNOWN" ? "REFUND_EVIDENCE_REVIEW" : null,
    },
  });
  if (request.state !== next || request.providerRefundId !== o.id)
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "TipRefundRequest",
        entityId: request.id,
        action: "delivery.tip.refund.reconciled",
        beforeJson: json(dto(request)),
        afterJson: json({ ...dto(saved), source: "stripe-api", observation: o }),
      },
    });
  return dto(saved);
}
export async function submitTipRefund(actor: string, raw: unknown) {
  const input = z
    .object({
      tipId: z.string().min(1).max(100),
      requestKey: z.uuid(),
      amountCents: z.number().int().positive().max(100000),
      reason: z.string().trim().min(5).max(500),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const id =
      "tip_refund_" +
      createHash("sha256")
        .update(actor + ":" + input.requestKey)
        .digest("hex"),
    hash = createHash("sha256").update(canonicalJson(input)).digest("hex");
  const replay = (r: TipRefundRequest) => {
    if (r.requestHash !== hash) throw fail();
    return dto(r);
  };
  const existing = await prisma.tipRefundRequest.findUnique({ where: { id } });
  if (existing) return replay(existing);
  const config = await readCommerce(true);
  if (
    process.env.DD_TIP_REFUNDS_ENABLED !== "true" ||
    (config.live && process.env.DD_LIVE_TIP_REFUNDS_ACCEPTED !== "true")
  )
    throw new AccountError(
      "Tip refund submission is not activated for this environment.",
      409,
    );
  const before = await tipAccountingSource(prisma, input.tipId);
  if (
    before.tip.stripeAccountId !== config.accountId ||
    before.tip.livemode !== config.live
  )
    throw fail();
  const observation = await observeTipRefunds(before.tip);
  const reserved = observation.refunds
    .filter(
      (r) =>
        !["failed", "canceled"].includes(r.status) ||
        (r.balanceTransactionId && !r.failureBalanceTransactionId),
    )
    .reduce((n, r) => n + r.amountCents, 0);
  if (
    observation.disputed ||
    observation.refunds.some((r) => ["pending", "requires_action"].includes(r.status)) ||
    input.amountCents + reserved > before.tip.totalCents!
  )
    throw fail();
  const claim = await prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    await tx.$queryRaw`SELECT id FROM "DeliveryTip" WHERE id=${input.tipId} FOR UPDATE`;
    const prior = await tx.tipRefundRequest.findUnique({ where: { id } });
    if (prior) {
      replay(prior);
      return { request: prior, created: false };
    }
    const current = await tipAccountingSource(tx, input.tipId);
    if (canonicalJson(current) !== canonicalJson(before)) throw fail();
    const others = await tx.tipRefundRequest.findMany({
      where: { tipId: input.tipId },
      take: 101,
    });
    if (others.length >= 100 || others.some((r) => unresolved.includes(r.state)))
      throw fail();
    for (const r of others) {
      const found = observation.refunds.find((o) => o.id === r.providerRefundId);
      if (!found) throw fail();
      match(r, found);
      if (state(found) !== r.state) throw fail();
    }
    const request = await tx.tipRefundRequest.create({
      data: {
        id,
        tipId: input.tipId,
        actorUserId: actor,
        requestHash: hash,
        amountCents: input.amountCents,
        reason: input.reason,
        accountId: config.accountId,
        livemode: config.live,
        paymentIntentId: before.tip.paymentIntentId!,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "TipRefundRequest",
        entityId: id,
        action: "delivery.tip.refund.claimed",
        afterJson: json({
          ...dto(request),
          tipId: input.tipId,
          amountCents: input.amountCents,
          requestHash: hash,
          accountId: config.accountId,
          livemode: config.live,
        }),
      },
    });
    return { request, created: true };
  });
  if (!claim.created) return replay(claim.request);
  try {
    // Only the invocation that created the durable claim can reach this one POST.
    await submitClaimedStripeTipRefund({
      requestId: id,
      requestHash: hash,
      amountCents: input.amountCents,
      submittedAt: claim.request.submittedAt.toISOString(),
      binding: {
        accountId: config.accountId,
        live: config.live,
        paymentIntentId: before.tip.paymentIntentId!,
        checkoutId: input.tipId,
        amountCents: before.tip.totalCents!,
        currency: "USD",
      },
    });
    return await reconcileTipRefund(actor, id);
  } catch {
    await prisma.tipRefundRequest.updateMany({
      where: { id, state: "SUBMITTING" },
      data: { state: "UNKNOWN", lastError: "REFUND_LOOKUP_REQUIRED" },
    });
    return dto(await prisma.tipRefundRequest.findUniqueOrThrow({ where: { id } }));
  }
}
async function reconcileAs(actor: string | null, id: string) {
  if (actor) await financeAccess(prisma, actor, true);
  const request = await prisma.tipRefundRequest.findUnique({ where: { id } });
  if (!request) throw new AccountError("Tip refund not found.", 404);
  const claims = await prisma.auditLog.findMany({
    where: {
      entityType: "TipRefundRequest",
      entityId: request.id,
      action: "delivery.tip.refund.claimed",
    },
    take: 2,
  });
  const proof = claims[0]?.afterJson as Record<string, unknown> | undefined;
  if (
    claims.length !== 1 ||
    claims[0].actorUserId !== request.actorUserId ||
    proof?.id !== request.id ||
    proof.tipId !== request.tipId ||
    proof.amountCents !== request.amountCents ||
    proof.requestHash !== request.requestHash ||
    proof.accountId !== request.accountId ||
    proof.livemode !== request.livemode
  )
    throw fail();
  const before = await tipAccountingSource(prisma, request.tipId);
  if (
    before.tip.paymentIntentId !== request.paymentIntentId ||
    before.tip.stripeAccountId !== request.accountId ||
    before.tip.livemode !== request.livemode
  )
    throw fail();
  const observation = await observeTipRefunds(before.tip);
  const matches = observation.refunds.filter(
    (o) => o.id === request.providerRefundId || o.requestId === request.id,
  );
  if (matches.length !== 1) throw fail();
  return prisma.$transaction(async (tx) => {
    if (actor) await financeAccess(tx, actor, true);
    await tx.$queryRaw`SELECT id FROM "DeliveryTip" WHERE id=${request.tipId} FOR UPDATE`;
    const current = await tipAccountingSource(tx, request.tipId);
    if (canonicalJson(current) !== canonicalJson(before)) throw fail();
    const latest = await tx.tipRefundRequest.findUniqueOrThrow({ where: { id } });
    if (latest.updatedAt.getTime() !== request.updatedAt.getTime()) throw fail();
    return saveObservation(tx, latest, matches[0], actor);
  });
}
export async function reconcileTipRefund(actor: string, rawId: unknown) {
  await financeAccess(prisma, actor, true);
  return reconcileAs(actor, z.string().min(1).max(100).parse(rawId));
}
export async function recoverTipRefunds(ownsLease: () => Promise<boolean>) {
  const config = await readCommerce(true);
  const rows = await prisma.tipRefundRequest.findMany({
    where: {
      accountId: config.accountId,
      livemode: config.live,
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
    await prisma.tipRefundRequest.update({
      where: { id: r.id },
      data: { recoveryCheckedAt: new Date() },
    });
    try {
      const result = await reconcileAs(null, r.id);
      if (!unresolved.includes(result.state)) completed++;
    } catch {
      await prisma.tipRefundRequest.update({
        where: { id: r.id },
        data: { lastError: "REFUND_LOOKUP_REQUIRED" },
      });
    }
  }
  return { checked: rows.length, completed, attention: rows.length - completed };
}

export function tipRefundRequestHold(
  requests: readonly TipRefundRequest[],
  refunds: readonly RefundObservation[],
) {
  if (requests.length > 100) return true;
  return requests.some((r) => {
    if (unresolved.includes(r.state) || r.lastError || !r.providerRefundId) return true;
    const found = refunds.find((o) => o.id === r.providerRefundId);
    if (!found) return true;
    try {
      match(r, found);
      return state(found) !== r.state;
    } catch {
      return true;
    }
  });
}
