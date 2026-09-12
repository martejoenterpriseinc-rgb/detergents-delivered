import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { canonicalJson } from "@/lib/commerce/domain";
import { refundRequestInput } from "@/lib/domain/refund-allocation";
import { AccountError } from "@/lib/domain/account";

export const manualRefundReceiptInput = z
  .object({
    orderId: z.string().min(1).max(100),
    requestId: z.string().min(1).max(100),
    method: z.enum(["CASH", "ZELLE"]),
    amountCents: z.number().int().positive().max(100_000_000),
    reference: z.string().trim().min(5).max(160),
    reason: z.string().trim().min(10).max(500),
    returnedAt: z.iso.datetime(),
    confirmed: z.literal(true),
  })
  .strict();
export const manualRefundDigest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
export function manualRefundReceiptKey(
  account: string,
  live: boolean,
  method: string,
  reference: string,
) {
  return (
    "dd:manual-refund:receipt:" + manualRefundDigest({ account, live, method, reference })
  );
}
const receiptEvidence = manualRefundReceiptInput
  .extend({
    actorUserId: z.string().min(1),
    settlementId: z.string().min(1),
    accountId: z.string().min(1),
    livemode: z.boolean(),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    receiptHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** An immutable staff receipt and matching audit are required; a display status is insufficient. */
export async function verifiedManualRefundReceipt(
  tx: Prisma.TransactionClient,
  requestId: string,
) {
  const r = await tx.refundRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      events: true,
      lines: true,
      refund: true,
      payment: true,
      order: { include: { checkoutAttempt: { include: { manualSettlement: true } } } },
    },
  });
  const records = r.events.filter((e) => e.type === "manual-refund.returned");
  const parsed = receiptEvidence.safeParse(records[0]?.evidenceJson);
  const fail = () =>
    new AccountError("Manual refund receipt evidence requires review.", 409);
  if (records.length !== 1 || !parsed.success) throw fail();
  const e = parsed.data,
    event = records[0],
    checkout = r.order.checkoutAttempt;
  const receipt = checkout?.manualSettlement;
  const receiptHash = e.receiptHash;
  const input = manualRefundReceiptInput.strip().parse(e);
  // Schema parsing above also prevents extra fields from silently entering the signed evidence.
  if (
    !receipt ||
    !checkout ||
    !r.refund ||
    r.payment.provider !== "MANUAL" ||
    r.status !== "SUCCEEDED" ||
    r.providerRefundId ||
    !r.submittedAt ||
    !event.verifiedAt ||
    event.status !== "SUCCEEDED" ||
    e.orderId !== r.orderId ||
    e.requestId !== r.id ||
    e.requestHash !== r.requestHash ||
    e.settlementId !== receipt.id ||
    e.method !== receipt.method ||
    e.method !== checkout.paymentMethod ||
    e.accountId !== r.providerAccountId ||
    e.accountId !== receipt.accountId ||
    e.livemode !== r.livemode ||
    e.livemode !== receipt.livemode ||
    e.amountCents !== r.amountCents ||
    receiptHash !== manualRefundDigest(input) ||
    new Date(e.returnedAt) < receipt.receivedAt ||
    new Date(e.returnedAt) > event.verifiedAt ||
    event.providerEventId !==
      manualRefundReceiptKey(e.accountId, e.livemode, e.method, e.reference) ||
    r.refund.externalId !== event.providerEventId ||
    r.refund.amountCents !== e.amountCents ||
    r.refund.paymentId !== r.paymentId ||
    r.refund.orderId !== r.orderId ||
    r.refund.currency !== "USD"
  )
    throw fail();
  const audits = await tx.auditLog.findMany({
    where: {
      entityType: "RefundRequest",
      entityId: r.id,
      action: "manual-refund.returned",
    },
    take: 2,
  });
  if (
    audits.length !== 1 ||
    audits[0].actorUserId !== e.actorUserId ||
    canonicalJson(audits[0].afterJson) !== canonicalJson(e)
  )
    throw fail();
  const prepared = await tx.auditLog.findMany({
    where: {
      entityType: "RefundRequest",
      entityId: r.id,
      action: "manual-refund.prepared",
    },
    take: 2,
  });
  const original = refundRequestInput.parse({
    requestKey: r.requestKey,
    orderId: r.orderId,
    paymentId: r.paymentId,
    reason: r.reason,
    lines: r.lines
      .map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity }))
      .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
  });
  const lines = r.lines
    .map((l) => ({
      orderItemId: l.orderItemId,
      quantity: l.quantity,
      netCents: l.netCents,
      taxCents: l.taxCents,
      rewardCents: l.rewardCents,
    }))
    .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  if (
    prepared.length !== 1 ||
    prepared[0].actorUserId !== r.actorUserId ||
    manualRefundDigest(original) !== r.requestHash ||
    canonicalJson(prepared[0].afterJson) !==
      canonicalJson({
        input: original,
        lines,
        amountCents: r.amountCents,
        settlementId: e.settlementId,
      })
  )
    throw fail();
  return e;
}

export const manualTaxEvidenceSchema = z
  .object({
    requestId: z.string().min(1),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    receiptHash: z.string().regex(/^[a-f0-9]{64}$/),
    actorUserId: z.string().min(1),
    accountId: z.string().min(1),
    livemode: z.boolean(),
    originalTaxTransactionId: z.string().regex(/^tax_[A-Za-z0-9]+$/),
    refundTaxTransactionId: z.string().regex(/^tax_[A-Za-z0-9]+$/),
    postedAt: z.number().int().positive(),
    taxLines: z
      .array(
        z
          .object({
            orderItemId: z.string().min(1),
            originalLineItemId: z.string().min(1),
            netCents: z.number().int().nonnegative(),
            taxCents: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export async function verifiedManualRefundTax(
  tx: Prisma.TransactionClient,
  requestId: string,
) {
  const events = await tx.refundRequestEvent.findMany({
    where: { refundRequestId: requestId, type: "manual-refund.tax.verified" },
    take: 2,
  });
  if (!events.length) return null;
  const fail = () => new AccountError("Manual refund tax receipt requires review.", 409);
  const parsed = manualTaxEvidenceSchema.safeParse(events[0].evidenceJson);
  if (events.length !== 1 || !parsed.success) throw fail();
  const e = parsed.data,
    event = events[0],
    receipt = await verifiedManualRefundReceipt(tx, requestId);
  const original = await tx.manualCheckoutSettlement.findUniqueOrThrow({
    where: { id: receipt.settlementId },
  });
  const request = await tx.refundRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { lines: true },
  });
  if (
    !event.verifiedAt ||
    event.status !== "SUCCEEDED" ||
    e.requestId !== requestId ||
    e.requestHash !== receipt.requestHash ||
    e.receiptHash !== receipt.receiptHash ||
    e.accountId !== receipt.accountId ||
    e.livemode !== receipt.livemode ||
    e.originalTaxTransactionId !== original.taxTransactionId ||
    e.refundTaxTransactionId === e.originalTaxTransactionId ||
    event.providerEventId !==
      "dd:manual-tax:verified:" +
        manualRefundDigest({
          account: e.accountId,
          live: e.livemode,
          id: e.refundTaxTransactionId,
        }) ||
    e.taxLines.length !== request.lines.length ||
    new Set(e.taxLines.map((l) => l.orderItemId)).size !== e.taxLines.length ||
    new Set(e.taxLines.map((l) => l.originalLineItemId)).size !== e.taxLines.length ||
    e.taxLines.some(
      (l) =>
        !request.lines.some(
          (r) =>
            r.orderItemId === l.orderItemId &&
            r.netCents === l.netCents &&
            r.taxCents === l.taxCents,
        ),
    )
  )
    throw fail();
  const audits = await tx.auditLog.findMany({
    where: {
      entityType: "RefundRequest",
      entityId: requestId,
      action: "manual-refund.tax.verified",
    },
    take: 2,
  });
  if (
    audits.length !== 1 ||
    audits[0].actorUserId !== e.actorUserId ||
    canonicalJson(audits[0].afterJson) !== canonicalJson(e)
  )
    throw fail();
  return { id: event.id, ...e };
}
