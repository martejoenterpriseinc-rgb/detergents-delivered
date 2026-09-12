CREATE TABLE "TipRefundRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tipId" TEXT NOT NULL REFERENCES "DeliveryTip"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorUserId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0 AND "amountCents" <= 100000),
  "currency" TEXT NOT NULL DEFAULT 'USD' CHECK ("currency" = 'USD'),
  "reason" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "livemode" BOOLEAN NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'SUBMITTING' CHECK ("state" IN ('SUBMITTING','UNKNOWN','PENDING','SUCCEEDED','FAILED','CANCELED')),
  "providerRefundId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recoveryCheckedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TipRefundRequest_result_check" CHECK ("state" IN ('SUBMITTING','UNKNOWN') OR "providerRefundId" IS NOT NULL)
);
CREATE UNIQUE INDEX "TipRefundRequest_providerRefundId_key" ON "TipRefundRequest"("providerRefundId");
CREATE INDEX "TipRefundRequest_tipId_state_idx" ON "TipRefundRequest"("tipId", "state");
CREATE INDEX "TipRefundRequest_state_recoveryCheckedAt_idx" ON "TipRefundRequest"("state", "recoveryCheckedAt");
