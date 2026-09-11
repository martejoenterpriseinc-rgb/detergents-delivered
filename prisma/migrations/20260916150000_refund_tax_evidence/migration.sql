CREATE TABLE "RefundTaxEvidence" (
 "id" TEXT PRIMARY KEY, "adjustmentId" TEXT NOT NULL UNIQUE,
 "providerAccountId" TEXT NOT NULL, "livemode" BOOLEAN NOT NULL,
 "reportRunId" TEXT NOT NULL, "fileId" TEXT NOT NULL,
 "reportHash" TEXT NOT NULL CHECK ("reportHash" ~ '^[a-f0-9]{64}$'),
 "originalTaxTransactionId" TEXT NOT NULL, "refundTaxTransactionId" TEXT NOT NULL,
 "taxCents" INTEGER NOT NULL CHECK ("taxCents" >= 0),
 "currency" TEXT NOT NULL CHECK ("currency" ~ '^[A-Z]{3}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RefundTaxEvidence_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "RefundAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RefundTaxEvidence_provider_refund_key" ON "RefundTaxEvidence"("providerAccountId", "livemode", "refundTaxTransactionId");
CREATE TRIGGER "RefundTaxEvidence_immutable" BEFORE UPDATE OR DELETE ON "RefundTaxEvidence"
FOR EACH ROW EXECUTE FUNCTION dd_preserve_refund_events();
