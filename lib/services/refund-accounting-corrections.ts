import type { Prisma } from "@prisma/client";
import { AccountError } from "@/lib/domain/account";
/** Caller holds the order lock; runs atomically with verified refund compensation. */
export async function flagRefundAccountingCorrections(
  tx: Prisma.TransactionClient,
  settlementId: string,
  actor: string | undefined,
) {
  const settlement = await tx.refundAdjustment.findUniqueOrThrow({
    where: { id: settlementId },
    include: { request: { include: { adjustments: true } } },
  });
  const compensation = settlement.request.adjustments.find(
    (a) => a.kind === "COMPENSATION",
  );
  if (
    settlement.kind !== "SETTLEMENT" ||
    !compensation ||
    !["FAILED", "CANCELED"].includes(settlement.request.status) ||
    !compensation.failureBalanceTransactionId ||
    compensation.providerRefundId !== settlement.providerRefundId ||
    (["cashCents", "netCents", "taxCents", "rewardCents"] as const).some(
      (k) => settlement[k] !== -compensation[k],
    )
  )
    throw new AccountError(
      "Verified refund compensation is required for accounting review.",
      409,
    );
  await tx.$queryRaw`SELECT id FROM "QboReceiptExport" WHERE "adjustmentId"=${settlementId} FOR UPDATE`;
  const records = await tx.qboReceiptExport.findMany({
    where: {
      adjustmentId: settlementId,
      status: { not: "CANCELED" },
      OR: [
        { reconciliationIssue: null },
        { reconciliationIssue: { not: "REFUND_COMPENSATION_REVIEW" } },
      ],
    },
    select: { id: true, status: true, reconciliationIssue: true },
  });
  for (const r of records) {
    await tx.qboReceiptExport.update({
      where: { id: r.id },
      data: { reconciliationIssue: "REFUND_COMPENSATION_REVIEW" },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "QboReceiptExport",
        entityId: r.id,
        action: "quickbooks.refund-correction.required",
        beforeJson: { reconciliationIssue: r.reconciliationIssue, status: r.status },
        afterJson: {
          reconciliationIssue: "REFUND_COMPENSATION_REVIEW",
          requestId: settlement.requestId,
          settlementId,
          compensationId: compensation.id,
        },
      },
    });
  }
  return { flagged: records.length };
}
