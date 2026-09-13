import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { financeAccess } from "./finance";
import { AccountError } from "@/lib/domain/account";
import { readCommerce } from "@/lib/commerce/runtime";
import { tipAccountingSource, observeTipRefunds } from "./tip-accounting-source";
import {
  approvedClaimReview,
  claimReviewSource,
  reviewFailure,
  reviewHash,
  type ReviewKind,
} from "./financial-claim-review-proof";
const kindSchema = z.enum(["TIP_REFUND", "MANUAL_REFUND_TAX", "MANUAL_CHECKOUT_TAX"]);
const target = z.object({ kind: kindSchema, claimId: z.string().min(1).max(100) });
const proposal = target
  .extend({
    requestKey: z.uuid(),
    evidenceReference: z.string().trim().min(10).max(500),
    evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    providerCase: z.string().trim().min(5).max(160),
    statement: z.string().trim().min(30).max(2000),
    reviewedThrough: z.iso.datetime(),
    confirmed: z.literal(true),
  })
  .strict();
const decision = z
  .object({
    id: z.string().min(1).max(100),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: z.string().trim().min(10).max(1000),
    confirmed: z.literal(true),
  })
  .strict();
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
async function lock(tx: Prisma.TransactionClient, kind: ReviewKind, id: string) {
  // Same source lock as financial mutations, followed by the review lock.
  if (kind === "TIP_REFUND") {
    const r = await tx.tipRefundRequest.findUniqueOrThrow({ where: { id } });
    await tx.$queryRaw`SELECT id FROM "DeliveryTip" WHERE id=${r.tipId} FOR UPDATE`;
  } else if (kind === "MANUAL_CHECKOUT_TAX") {
    await tx.$queryRaw`SELECT id FROM "ManualCheckoutSettlement" WHERE id=${id} FOR UPDATE`;
  } else {
    const r = await tx.refundRequest.findUniqueOrThrow({ where: { id } });
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${r.orderId} FOR UPDATE`;
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dd:claim-review:${kind}:${id}`},0))`;
}
async function inspect(kind: ReviewKind, id: string) {
  const source = await claimReviewSource(prisma, kind, id),
    c = await readCommerce(true);
  if (c.accountId !== source.accountId || c.live !== source.live) throw reviewFailure();
  if (Date.now() - new Date(source.submittedAt).getTime() < 24 * 3600000)
    throw new AccountError("Use original-key recovery during the first 24 hours.", 409);
  if (kind === "TIP_REFUND") {
    const r = await prisma.tipRefundRequest.findUniqueOrThrow({ where: { id } });
    const t = await tipAccountingSource(prisma, r.tipId),
      o = await observeTipRefunds(t.tip);
    // A bounded, complete current lookup is corroboration, never the proof of non-creation.
    if (
      o.disputed ||
      o.refunds.some(
        (x) =>
          x.requestId === id ||
          x.requestHash === r.requestHash ||
          ["pending", "requires_action"].includes(x.status),
      )
    )
      throw reviewFailure();
    if (
      t.tip.paymentIntentId !== r.paymentIntentId ||
      t.tip.stripeAccountId !== r.accountId ||
      t.tip.livemode !== r.livemode
    )
      throw reviewFailure();
    const known = await prisma.tipRefundRequest.findMany({
      where: { tipId: r.tipId },
      take: 101,
    });
    if (
      known.length > 100 ||
      o.refunds.some(
        (x) =>
          !known.some(
            (k) =>
              k.id !== id &&
              k.providerRefundId === x.id &&
              k.requestHash === x.requestHash &&
              k.amountCents === x.amountCents,
          ),
      )
    )
      throw reviewFailure();
  }
  return source;
}
export async function readClaimReviews(actor: string, raw: unknown) {
  await financeAccess(prisma, actor);
  const d = target.strict().parse(raw);
  const rows = await prisma.financialClaimReview.findMany({
    where: d,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  return {
    rows: rows.map((r) => ({
      ...r,
      canApprove: r.proposedById !== actor && r.decision === "PENDING",
    })),
  };
}
export async function proposeClaimReview(actor: string, raw: unknown) {
  const d = proposal.parse(raw);
  await financeAccess(prisma, actor, true);
  const id = "claim_review_" + reviewHash({ actor, requestKey: d.requestKey });
  const prior = await prisma.financialClaimReview.findUnique({ where: { id } });
  const submittedEvidence = {
    evidenceReference: d.evidenceReference,
    evidenceSha256: d.evidenceSha256,
    providerCase: d.providerCase,
    statement: d.statement,
    reviewedThrough: d.reviewedThrough,
    kind: d.kind,
    claimId: d.claimId,
  };
  const replay = (r: NonNullable<typeof prior>) => {
    if (
      reviewHash({
        ...submittedEvidence,
        reviewedThrough: new Date(d.reviewedThrough).toISOString(),
      }) !==
      reviewHash({
        evidenceReference: r.evidenceReference,
        evidenceSha256: r.evidenceSha256,
        providerCase: r.providerCase,
        statement: r.statement,
        reviewedThrough: r.reviewedThrough.toISOString(),
        kind: r.kind,
        claimId: r.claimId,
      })
    )
      throw reviewFailure();
    return { id: r.id, decision: r.decision };
  };
  if (prior) return replay(prior);
  const source = await inspect(d.kind, d.claimId);
  const through = new Date(d.reviewedThrough);
  if (
    through.getTime() < new Date(source.submittedAt).getTime() + 24 * 3600000 ||
    through.getTime() > Date.now() ||
    Date.now() - through.getTime() > 24 * 3600000
  )
    throw new AccountError(
      "Provider confirmation must cover at least 24 hours after the original claim and be reviewed within the last 24 hours.",
      409,
    );
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    await lock(tx, d.kind, d.claimId);
    const retry = await tx.financialClaimReview.findUnique({ where: { id } });
    if (retry) return replay(retry);
    if (
      reviewHash(await claimReviewSource(tx, d.kind, d.claimId)) !== reviewHash(source) ||
      (await approvedClaimReview(tx, d.kind, d.claimId, source))
    )
      throw reviewFailure();
    const r = await tx.financialClaimReview.create({
      data: {
        id,
        ...submittedEvidence,
        reviewedThrough: through,
        proposedById: actor,
        sourceHash: reviewHash(source),
        sourceJson: json(source),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "FinancialClaimReview",
        entityId: id,
        action: "financial-claim.review.proposed",
        afterJson: json(r),
      },
    });
    return { id, decision: r.decision };
  });
}
export async function decideClaimReview(actor: string, raw: unknown) {
  const d = decision.parse(raw);
  await financeAccess(prisma, actor, true);
  const r = await prisma.financialClaimReview.findUniqueOrThrow({ where: { id: d.id } });
  const kind = kindSchema.parse(r.kind);
  if (d.decision === "APPROVED" && r.proposedById === actor)
    throw new AccountError(
      "A different finance administrator must approve the evidence.",
      403,
    );
  // An identical retry never repeats the financial mutation or a provider POST.
  if (r.decision !== "PENDING") {
    if (
      r.decision !== d.decision ||
      r.decidedById !== actor ||
      r.decisionReason !== d.reason
    )
      throw reviewFailure();
    return { id: r.id, decision: r.decision };
  }
  const source = d.decision === "APPROVED" ? await inspect(kind, r.claimId) : null;
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    await lock(tx, kind, r.claimId);
    const current = await tx.financialClaimReview.findUniqueOrThrow({
      where: { id: r.id },
    });
    if (current.decision !== "PENDING") {
      if (
        current.decision !== d.decision ||
        current.decidedById !== actor ||
        current.decisionReason !== d.reason
      )
        throw reviewFailure();
      return { id: r.id, decision: current.decision };
    }
    if (
      source &&
      (r.sourceHash !== reviewHash(source) ||
        r.sourceHash !== reviewHash(await claimReviewSource(tx, kind, r.claimId)) ||
        Date.now() - r.reviewedThrough.getTime() > 24 * 3600000)
    )
      throw reviewFailure();
    if (source && (await approvedClaimReview(tx, kind, r.claimId, source)))
      throw new AccountError("Another review already approved this claim.", 409);
    await tx.financialClaimReview.update({
      where: { id: r.id },
      data: {
        decision: d.decision,
        decidedById: actor,
        decidedAt: new Date(Date.now()),
        decisionReason: d.reason,
      },
    });
    if (source && kind === "TIP_REFUND")
      await tx.tipRefundRequest.update({
        where: { id: r.claimId },
        data: { state: "NOT_CREATED", lastError: null, recoveryCheckedAt: new Date() },
      });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "FinancialClaimReview",
        entityId: r.id,
        action: "financial-claim.review.decided",
        afterJson: {
          decision: d.decision,
          reason: d.reason,
          sourceHash: r.sourceHash,
          source: "independent-staff-provider-evidence-review",
        },
      },
    });
    return { id: r.id, decision: d.decision };
  });
}
