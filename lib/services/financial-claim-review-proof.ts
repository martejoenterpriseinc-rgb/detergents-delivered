import { createHash } from "node:crypto";
import type { Prisma, TipRefundRequest } from "@prisma/client";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "@/lib/commerce/domain";
export type ReviewKind = "TIP_REFUND" | "MANUAL_REFUND_TAX" | "MANUAL_CHECKOUT_TAX";
export const reviewHash = (v: unknown) =>
  createHash("sha256").update(canonicalJson(v)).digest("hex");
export const reviewFailure = () =>
  new AccountError(
    "Current claim and independently approved provider non-creation evidence are required.",
    409,
  );
export function tipClaimSource(r: TipRefundRequest) {
  return {
    kind: "TIP_REFUND",
    claimId: r.id,
    requestHash: r.requestHash,
    accountId: r.accountId,
    live: r.livemode,
    paymentIntentId: r.paymentIntentId,
    tipId: r.tipId,
    amountCents: r.amountCents,
    currency: r.currency,
    submittedAt: r.submittedAt.toISOString(),
  };
}
export async function claimReviewSource(
  tx: Prisma.TransactionClient,
  kind: ReviewKind,
  id: string,
) {
  if (kind === "TIP_REFUND") {
    const r = await tx.tipRefundRequest.findUniqueOrThrow({ where: { id } });
    const audit = await tx.auditLog.findMany({
      where: {
        entityType: "TipRefundRequest",
        entityId: id,
        action: "delivery.tip.refund.claimed",
      },
      take: 2,
    });
    const p = audit[0]?.afterJson as Record<string, unknown> | undefined;
    if (
      audit.length !== 1 ||
      audit[0].actorUserId !== r.actorUserId ||
      p?.id !== id ||
      p.tipId !== r.tipId ||
      p.requestHash !== r.requestHash ||
      p.amountCents !== r.amountCents ||
      p.accountId !== r.accountId ||
      p.livemode !== r.livemode
    )
      throw reviewFailure();
    if (!["SUBMITTING", "UNKNOWN", "NOT_CREATED"].includes(r.state) || r.providerRefundId)
      throw reviewFailure();
    return tipClaimSource(r);
  }
  if (kind === "MANUAL_CHECKOUT_TAX") {
    const r = await tx.manualCheckoutSettlement.findUniqueOrThrow({
      where: { id },
      include: { checkout: true },
    });
    if (
      !["UNKNOWN", "SUBMITTING"].includes(r.state) ||
      !r.submittedAt ||
      r.taxTransactionId ||
      r.taxEvidence
    )
      throw reviewFailure();
    return {
      kind,
      claimId: id,
      requestHash: r.requestHash,
      accountId: r.accountId,
      live: r.livemode,
      submittedAt: r.submittedAt.toISOString(),
      checkoutId: r.checkoutId,
      amountCents: r.amountCents,
      receivedAt: r.receivedAt.toISOString(),
      snapshot: r.checkout.snapshot,
    };
  }
  const r = await tx.refundRequest.findUniqueOrThrow({
    where: { id },
    include: { lines: true },
  });
  const c = await tx.refundRequestEvent.findUniqueOrThrow({
    where: { providerEventId: `dd:manual-tax:claim:${id}` },
  });
  const a = await tx.checkoutAttempt.findUniqueOrThrow({
    where: { orderId: r.orderId },
    include: { manualSettlement: true },
  });
  if (
    !a.manualSettlement?.taxTransactionId ||
    !["CASH", "ZELLE"].includes(a.paymentMethod)
  )
    throw reviewFailure();
  return {
    kind,
    claimId: id,
    requestHash: r.requestHash,
    accountId: r.providerAccountId,
    live: r.livemode,
    submittedAt: c.createdAt.toISOString(),
    claimEvidence: c.evidenceJson,
    orderId: r.orderId,
    originalTaxTransactionId: a.manualSettlement.taxTransactionId,
    lines: r.lines
      .map((l) => ({
        id: l.id,
        orderItemId: l.orderItemId,
        quantity: l.quantity,
        netCents: l.netCents,
        taxCents: l.taxCents,
      }))
      .sort((x, y) => x.id.localeCompare(y.id)),
  };
}
export async function approvedClaimReview(
  tx: Prisma.TransactionClient,
  kind: ReviewKind,
  id: string,
  source?: unknown,
) {
  const rows = await tx.financialClaimReview.findMany({
    where: { kind, claimId: id, decision: "APPROVED" },
    take: 2,
  });
  if (!rows.length) return null;
  const r = rows[0];
  if (
    rows.length !== 1 ||
    !r.decidedById ||
    r.decidedById === r.proposedById ||
    !r.decidedAt ||
    r.sourceHash !== reviewHash(r.sourceJson) ||
    r.sourceHash !== reviewHash(source ?? (await claimReviewSource(tx, kind, id)))
  )
    throw reviewFailure();
  return r;
}
export async function requireReviewedTaxRetry(
  tx: Prisma.TransactionClient,
  kind: "MANUAL_REFUND_TAX" | "MANUAL_CHECKOUT_TAX",
  id: string,
) {
  const r = await approvedClaimReview(tx, kind, id);
  if (!r) throw reviewFailure();
  return r.id;
}
