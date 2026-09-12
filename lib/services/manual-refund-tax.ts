import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { financeAccess } from "./finance";
import { recordedSaleSource } from "./sales-refund-source";
import {
  verifiedManualRefundReceipt,
  verifiedManualRefundTax,
  manualRefundDigest,
  manualTaxEvidenceSchema,
} from "./manual-refund-evidence";
import {
  executeManualTaxReversal,
  type ManualTaxReversalBinding,
} from "@/lib/commerce/manual-refund-tax";
const input = z
  .object({
    orderId: z.string().min(1).max(100),
    requestId: z.string().min(1).max(100),
    taxTransactionId: z
      .string()
      .regex(/^tax_[A-Za-z0-9]+$/)
      .max(100)
      .optional(),
    confirmed: z.literal(true),
  })
  .strict();
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
async function snapshot(
  tx: Prisma.TransactionClient,
  actor: string,
  d: z.infer<typeof input>,
) {
  await financeAccess(tx, actor, true);
  const sale = await recordedSaleSource(tx, d.orderId),
    receipt = await verifiedManualRefundReceipt(tx, d.requestId);
  if (
    receipt.orderId !== sale.orderId ||
    !sale.taxTransactionId ||
    !sale.manualSettlementId
  )
    throw new AccountError("Manual refund not found on this sale.", 409);
  const r = await tx.refundRequest.findUniqueOrThrow({
    where: { id: d.requestId },
    include: { lines: true, adjustments: true },
  });
  const checkout = await tx.checkoutAttempt.findUniqueOrThrow({
    where: { orderId: d.orderId },
    include: { manualSettlement: true },
  });
  if (r.adjustments.length !== 1 || r.adjustments[0].kind !== "SETTLEMENT")
    throw new AccountError("Manual refund accounting requires review.", 409);
  const binding: ManualTaxReversalBinding = {
    requestId: r.id,
    requestHash: r.requestHash,
    checkoutId: checkout.id,
    settlementId: sale.manualSettlementId,
    accountId: sale.providerAccountId,
    live: sale.livemode,
    originalTransactionId: sale.taxTransactionId,
    receivedAt: checkout.manualSettlement!.receivedAt.toISOString(),
    address: sale.address,
    saleLines: sale.lines
      .map((l) => ({
        variantId: l.variantId,
        netCents: l.netCents,
        taxCents: l.taxCents,
        taxCode: l.taxCode,
      }))
      .sort((a, b) => a.variantId.localeCompare(b.variantId)),
    refundLines: r.lines
      .map((l) => {
        const original = sale.lines.find((v) => v.orderItemId === l.orderItemId);
        if (!original || l.quantity > original.quantity || l.quantity < 1)
          throw new AccountError("Refund line needs review.", 409);
        return {
          orderItemId: l.orderItemId,
          variantId: original.variantId,
          netCents: l.netCents,
          taxCents: l.taxCents,
          quantity: l.quantity,
        };
      })
      .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
  };
  return { binding, receiptHash: receipt.receiptHash };
}
/** Tax creation is separate from money return; durable claims are never automatically reposted. */
export async function reconcileManualRefundTax(actor: string, raw: unknown) {
  const d = input.parse(raw);
  await financeAccess(prisma, actor, true);
  const before = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${d.orderId} FOR UPDATE`;
    const s = await snapshot(tx, actor, d);
    const verified = await verifiedManualRefundTax(tx, d.requestId);
    if (verified) {
      if (d.taxTransactionId && d.taxTransactionId !== verified.refundTaxTransactionId)
        throw new AccountError("Another tax reversal is already recorded.", 409);
      return { s, verified };
    }
    const key = `dd:manual-tax:claim:${d.requestId}`;
    const previous = await tx.refundRequestEvent.findUnique({
      where: { providerEventId: key },
    });
    if (previous) {
      const proof = z.object({ sourceHash: z.string() }).parse(previous.evidenceJson);
      if (proof.sourceHash !== manualRefundDigest(s))
        throw new AccountError(
          "Original refund records changed after the tax claim.",
          409,
        );
      if (!d.taxTransactionId)
        throw new AccountError(
          "Tax submission was already claimed. Supply the existing reversal transaction ID for read-only recovery; do not create another reversal.",
          409,
        );
    } else {
      if (d.taxTransactionId)
        throw new AccountError("No tax submission claim exists for this refund.", 409);
      if (
        process.env.DD_MANUAL_REFUND_TAX_ENABLED !== "true" ||
        (s.binding.live && process.env.DD_LIVE_MANUAL_REFUND_TAX_ACCEPTED !== "true")
      )
        throw new AccountError("Manual refund tax submission is not activated.", 503);
      await tx.refundRequestEvent.create({
        data: {
          refundRequestId: d.requestId,
          providerEventId: key,
          type: "manual-refund.tax.claimed",
          status: "SUBMITTING",
          evidenceJson: { sourceHash: manualRefundDigest(s) },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor,
          entityType: "RefundRequest",
          entityId: d.requestId,
          action: "manual-refund.tax.claimed",
          afterJson: { sourceHash: manualRefundDigest(s) },
        },
      });
    }
    return { s, verified: null };
  });
  if (before.verified) return { matched: true, id: before.verified.id };
  await financeAccess(prisma, actor, true);
  // A failure leaves the immutable claim for GET-only recovery. No refund/reward history is changed.
  const observed = await executeManualTaxReversal(
    before.s.binding,
    d.taxTransactionId,
  ).catch(() => {
    throw new AccountError(
      "Tax submission could not be confirmed. Preserve the returned-money receipt and recover the existing tax reversal by ID.",
      409,
    );
  });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${d.orderId} FOR UPDATE`;
    const after = await snapshot(tx, actor, d);
    if (manualRefundDigest(after) !== manualRefundDigest(before.s))
      throw new AccountError("Refund records changed during tax verification.", 409);
    const prior = await verifiedManualRefundTax(tx, d.requestId);
    if (prior) {
      if (prior.refundTaxTransactionId !== observed.refundTaxTransactionId)
        throw new AccountError("Tax reversal conflict.", 409);
      return { matched: true, id: prior.id };
    }
    const e = manualTaxEvidenceSchema.parse({
      ...observed,
      requestId: d.requestId,
      requestHash: after.binding.requestHash,
      receiptHash: after.receiptHash,
      actorUserId: actor,
      accountId: after.binding.accountId,
      livemode: after.binding.live,
    });
    const event = await tx.refundRequestEvent.create({
      data: {
        refundRequestId: d.requestId,
        type: "manual-refund.tax.verified",
        status: "SUCCEEDED",
        verifiedAt: new Date(),
        providerEventId:
          "dd:manual-tax:verified:" +
          manualRefundDigest({
            account: e.accountId,
            live: e.livemode,
            id: e.refundTaxTransactionId,
          }),
        evidenceJson: json(e),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "RefundRequest",
        entityId: d.requestId,
        action: "manual-refund.tax.verified",
        afterJson: json(e),
      },
    });
    await verifiedManualRefundTax(tx, d.requestId);
    return { matched: true, id: event.id };
  });
}
