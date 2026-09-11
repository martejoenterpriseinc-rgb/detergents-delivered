import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "@/lib/commerce/domain";
import { readRefundTaxEvidence } from "@/lib/commerce/tax-report";
import { financeAccess } from "./finance";

export const refundTaxEvidenceInput = z
  .object({
    adjustmentId: z.string().min(1).max(100),
    reportRunId: z
      .string()
      .regex(/^frr_[A-Za-z0-9]+$/)
      .max(100),
    confirmed: z.literal(true),
  })
  .strict();
async function snapshot(tx: Prisma.TransactionClient, actor: string, id: string) {
  await financeAccess(tx, actor, true);
  const adjustment = await tx.refundAdjustment.findUnique({
    where: { id },
    include: {
      request: {
        include: {
          order: { include: { checkoutAttempt: true } },
          payment: { include: { events: true } },
        },
      },
    },
  });
  if (!adjustment) throw new AccountError("Refund adjustment not found.", 404);
  const { request } = adjustment;
  const { order, payment } = request;
  const checkout = order.checkoutAttempt;
  if (
    adjustment.kind !== "SETTLEMENT" ||
    !adjustment.providerRefundId ||
    !checkout?.stripeSessionId ||
    checkout.state !== "PAID" ||
    !payment.externalId ||
    payment.provider !== "STRIPE" ||
    !["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status) ||
    request.orderId !== payment.orderId ||
    payment.amountCents !== order.totalCents ||
    request.providerAccountId !== checkout.stripeAccountId ||
    request.livemode !== checkout.livemode ||
    adjustment.currency !== order.currency ||
    payment.currency !== order.currency ||
    !payment.events.some(
      (e) =>
        e.verifiedAt &&
        e.externalId === `checkout:${checkout.id}:paid` &&
        ["checkout.session.completed", "checkout.session.reconciled"].includes(e.type),
    )
  )
    throw new AccountError("Original refund and payment evidence need review.", 409);
  return {
    adjustmentId: adjustment.id,
    orderId: order.id,
    binding: {
      accountId: request.providerAccountId,
      live: request.livemode,
      paymentIntentId: payment.externalId,
      sessionId: checkout.stripeSessionId,
      providerRefundId: adjustment.providerRefundId,
      saleTotalCents: order.totalCents,
      saleTaxCents: order.taxCents,
      refundCents: adjustment.cashCents,
      refundTaxCents: adjustment.taxCents,
      currency: adjustment.currency,
    },
  };
}
export async function matchRefundTaxEvidence(actor: string, raw: unknown) {
  const input = refundTaxEvidenceInput.parse(raw);
  const before = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return snapshot(tx, actor, input.adjustmentId);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const observed = await readRefundTaxEvidence(input.reportRunId, before.binding);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${before.orderId} FOR UPDATE`;
    const after = await snapshot(tx, actor, input.adjustmentId);
    if (canonicalJson(before) !== canonicalJson(after))
      throw new AccountError("Payment records changed. Check the tax report again.", 409);
    const prior = await tx.refundTaxEvidence.findUnique({
      where: { adjustmentId: input.adjustmentId },
    });
    if (prior) {
      if (
        prior.originalTaxTransactionId !== observed.originalTaxTransactionId ||
        prior.refundTaxTransactionId !== observed.refundTaxTransactionId ||
        prior.taxCents !== observed.taxCents
      )
        throw new AccountError(
          "A different tax report receipt is already recorded.",
          409,
        );
      return { matched: true, id: prior.id };
    }
    if (observed.taxCents !== before.binding.refundTaxCents)
      throw new AccountError("Tax amounts do not match.", 409);
    const saved = await tx.refundTaxEvidence.create({
      data: {
        adjustmentId: input.adjustmentId,
        ...observed,
        providerAccountId: before.binding.accountId,
        livemode: before.binding.live,
        currency: before.binding.currency,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "refund.tax-report.matched",
        entityType: "RefundAdjustment",
        entityId: input.adjustmentId,
        afterJson: {
          evidenceId: saved.id,
          taxCents: saved.taxCents,
          source: "stripe-report-api",
        },
      },
    });
    return { matched: true, id: saved.id };
  });
}
