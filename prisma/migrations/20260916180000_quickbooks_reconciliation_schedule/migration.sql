ALTER TABLE "QboExpenseExport" ADD COLUMN "recoveryCheckedAt" TIMESTAMP(3), ADD COLUMN "reconciliationIssue" TEXT;
CREATE INDEX "QboExpenseExport_recovery_idx" ON "QboExpenseExport"("mode","realm","status","recoveryCheckedAt");
