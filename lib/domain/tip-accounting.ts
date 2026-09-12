import { z } from "zod";
import { businessDate, dateSchema } from "./operations";
import type { RefundObservation } from "@/lib/commerce/refund-provider";
export const tipPayoutInput = z
  .object({
    tipId: z.string().min(1).max(100),
    requestKey: z.uuid(),
    amountCents: z.number().int().positive().max(50000),
    reference: z.string().trim().min(5).max(160),
    paidOn: dateSchema.refine(
      (v) => v <= businessDate(),
      "A transfer cannot be dated in the future.",
    ),
    reason: z.string().trim().min(5).max(500),
    reversalOfId: z.string().min(1).max(100).optional(),
    confirmed: z.literal(true),
  })
  .strict();
export function tipAccounting(
  amountCents: number,
  totalCents: number,
  refunds: readonly RefundObservation[],
  payouts: readonly {
    id: string;
    kind: string;
    amountCents: number;
    reversalOfId: string | null;
  }[],
  allocations: readonly {
    providerRefundId: string;
    cashCents: number;
    taxCents: number;
  }[] = [],
) {
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    !Number.isSafeInteger(totalCents) ||
    totalCents < amountCents
  )
    throw Error("Invalid tip source");
  const seen = new Set<string>();
  let refundedCashCents = 0,
    review = false;
  for (const r of refunds) {
    if (
      seen.has(r.id) ||
      !Number.isSafeInteger(r.amountCents) ||
      r.amountCents <= 0 ||
      r.amountCents > totalCents ||
      r.currency !== "USD"
    )
      throw Error("Invalid refund evidence");
    seen.add(r.id);
    if (r.status === "succeeded") {
      refundedCashCents += r.amountCents;
      if (!r.balanceTransactionId) review = true;
    } else if (
      r.status === "pending" ||
      r.status === "requires_action" ||
      (r.balanceTransactionId && !r.failureBalanceTransactionId)
    )
      review = true;
  }
  if (refundedCashCents > totalCents) throw Error("Refunds exceed tip payment");
  const reversed = new Set<string>();
  let paidCents = 0;
  for (const p of payouts) {
    if (!Number.isSafeInteger(p.amountCents) || p.amountCents <= 0)
      throw Error("Invalid payout");
    if (p.kind === "PAYMENT" && !p.reversalOfId) paidCents += p.amountCents;
    else if (p.kind === "REVERSAL") {
      const parent = payouts.find((v) => v.id === p.reversalOfId && v.kind === "PAYMENT");
      if (!parent || parent.amountCents !== p.amountCents || reversed.has(parent.id))
        throw Error("Invalid payout reversal");
      reversed.add(parent.id);
      paidCents -= p.amountCents;
    } else throw Error("Invalid payout entry");
  }
  const successful = refunds.filter((r) => r.status === "succeeded");
  const allocated = new Map<string, { cashCents: number; taxCents: number }>();
  for (const a of allocations) {
    if (
      allocated.has(a.providerRefundId) ||
      !Number.isSafeInteger(a.cashCents) ||
      !Number.isSafeInteger(a.taxCents) ||
      a.cashCents <= 0 ||
      a.taxCents < 0 ||
      a.taxCents > a.cashCents
    )
      throw Error("Invalid tip tax allocation");
    allocated.set(a.providerRefundId, a);
  }
  let allocatedTip = 0,
    allocatedTax = 0;
  for (const r of successful) {
    const a = allocated.get(r.id);
    if (a) {
      if (a.cashCents !== r.amountCents)
        throw Error("Tip refund allocation amount changed");
      allocatedTip += a.cashCents - a.taxCents;
      allocatedTax += a.taxCents;
    }
  }
  if (allocatedTip > amountCents || allocatedTax > totalCents - amountCents)
    throw Error("Tip refund allocation exceeds original payment");
  // A failed/refunded-back debit does not consume the previously matched allocation.
  const matched = successful.length > 0 && successful.every((r) => allocated.has(r.id));
  const partialRefund = refundedCashCents > 0 && refundedCashCents < totalCents;
  const unresolvedPartial = partialRefund && !matched;
  const refundedTipCents = matched
    ? allocatedTip
    : partialRefund
      ? null
      : refundedCashCents === totalCents
        ? amountCents
        : 0;
  const owedCents =
    refundedTipCents === null ? null : amountCents - refundedTipCents - paidCents;
  return {
    refundedCashCents,
    refundedTipCents,
    paidCents,
    review: review || unresolvedPartial,
    payableCents: review || unresolvedPartial ? 0 : Math.max(0, owedCents!),
    recoverableCents: owedCents === null ? null : Math.max(0, -owedCents),
    taxRefundEvidence: matched ? ("MATCHED" as const) : ("UNVERIFIED" as const),
    refundedTaxCents: matched ? allocatedTax : null,
  };
}
