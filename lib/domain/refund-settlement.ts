import { AccountError } from "./account";
import type { RefundRequestStatus } from "@prisma/client";
import type { ProviderRefundStatus } from "@/lib/commerce/refund-provider";

/** Terminal failures cannot be revived by an older provider observation. */
export function refundTransition(
  current: RefundRequestStatus,
  observed: ProviderRefundStatus,
) {
  const target = observed.toUpperCase() as RefundRequestStatus;
  if (current === "PREPARED")
    throw new AccountError("Submit the saved refund first.", 409);
  if (
    (["FAILED", "CANCELED"].includes(current) && target !== current) ||
    (current === "SUCCEEDED" && ["PENDING", "REQUIRES_ACTION"].includes(target))
  )
    throw new AccountError("Refund status requires manual reconciliation.", 409);
  return {
    target,
    settle: target === "SUCCEEDED" && current !== "SUCCEEDED",
    compensate: current === "SUCCEEDED" && ["FAILED", "CANCELED"].includes(target),
  };
}

/** Legacy rows retain their historical value. New rows retain their gross receipt
 * and subtract only immutable compensating entries, never a mutable display status.
 */
export function effectiveRefundCents(refund: {
  amountCents: number;
  request?: { adjustments: { kind: string; cashCents: number }[] } | null;
}) {
  const value =
    refund.amountCents +
    (refund.request?.adjustments ?? [])
      .filter((a) => a.kind === "COMPENSATION")
      .reduce((sum, a) => sum + a.cashCents, 0);
  if (!Number.isSafeInteger(value) || value < 0 || value > refund.amountCents)
    throw new AccountError("Refund accounting requires reconciliation.", 409);
  return value;
}
export const refundAccountingSelect = {
  amountCents: true,
  request: { select: { adjustments: { select: { kind: true, cashCents: true } } } },
} as const;
