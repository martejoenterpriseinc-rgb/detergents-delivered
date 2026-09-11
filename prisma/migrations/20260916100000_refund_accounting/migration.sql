CREATE TABLE "RefundAdjustment" (
 "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('SETTLEMENT', 'COMPENSATION')),
 "cashCents" INTEGER NOT NULL, "netCents" INTEGER NOT NULL,
 "taxCents" INTEGER NOT NULL, "rewardCents" INTEGER NOT NULL,
 "currency" TEXT NOT NULL CHECK ("currency" ~ '^[A-Z]{3}$'),
 "providerRefundId" TEXT NOT NULL, "balanceTransactionId" TEXT,
 "failureBalanceTransactionId" TEXT,
 "taxEvidenceStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RefundAdjustment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "RefundAdjustment_balanced" CHECK ("cashCents" = "netCents" + "taxCents"),
 CONSTRAINT "RefundAdjustment_signs" CHECK (
  ("kind" = 'SETTLEMENT' AND "cashCents" > 0 AND "netCents" >= 0 AND "taxCents" >= 0 AND "rewardCents" >= 0) OR
  ("kind" = 'COMPENSATION' AND "cashCents" < 0 AND "netCents" <= 0 AND "taxCents" <= 0 AND "rewardCents" <= 0)
 )
);
CREATE UNIQUE INDEX "RefundAdjustment_requestId_kind_key" ON "RefundAdjustment"("requestId", "kind");
CREATE TRIGGER "RefundAdjustment_immutable" BEFORE UPDATE OR DELETE ON "RefundAdjustment"
FOR EACH ROW EXECUTE FUNCTION dd_preserve_refund_events();
