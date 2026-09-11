ALTER TABLE "RefundRequest" ADD COLUMN "recoveryCheckedAt" TIMESTAMP(3);
CREATE INDEX "RefundRequest_livemode_providerAccountId_recoveryCheckedAt_idx" ON "RefundRequest"("livemode", "providerAccountId", "recoveryCheckedAt");
