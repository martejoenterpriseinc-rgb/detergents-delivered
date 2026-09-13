import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import { AccountError } from "@/lib/domain/account";
import {
  refundCorrectionSource,
  verifiedRefundTaxCorrection,
} from "./refund-tax-corrections";
import { recordedRefundSource } from "./sales-refund-source";
/** Caller holds the order lock. Returns the immutable, posted receipt to offset. */
export async function correctionReceiptParent(
  tx: Prisma.TransactionClient,
  compensationId: string,
  mode: string,
  realm: string,
) {
  const source = await refundCorrectionSource(tx, compensationId),
    tax = await verifiedRefundTaxCorrection(tx, compensationId);
  const parent = await tx.qboReceiptExport.findFirst({
    where: {
      adjustmentId: source.settlementId,
      status: "POSTED",
      mode,
      realm,
      entity: "RefundReceipt",
    },
  });
  if (
    !tax ||
    !parent ||
    !parent.externalId ||
    (parent.reconciliationIssue &&
      parent.reconciliationIssue !== "REFUND_COMPENSATION_REVIEW") ||
    !isDeepStrictEqual(
      (parent.source as { refund: unknown }).refund,
      await recordedRefundSource(tx, source.orderId, source.settlementId),
    )
  )
    throw new AccountError(
      "Reconcile the original refund receipt and its tax correction first.",
      409,
    );
  return parent;
}
