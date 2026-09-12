ALTER TABLE "CheckoutAttempt" ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'STRIPE';
ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "CheckoutAttempt_paymentMethod_check" CHECK ("paymentMethod" IN ('STRIPE', 'CASH', 'ZELLE'));
CREATE TABLE "ManualCheckoutSettlement" (
 "id" TEXT PRIMARY KEY,
 "checkoutId" TEXT NOT NULL REFERENCES "CheckoutAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "method" TEXT NOT NULL CHECK ("method" IN ('CASH','ZELLE')),
 "reference" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0 AND "amountCents" <= 1000000),
 "currency" TEXT NOT NULL DEFAULT 'USD' CHECK ("currency" = 'USD'),
 "receivedAt" TIMESTAMP(3) NOT NULL,
 "actorUserId" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "approvalId" TEXT NOT NULL,
 "approvalVersion" INTEGER NOT NULL,
 "requestHash" TEXT NOT NULL,
 "accountId" TEXT NOT NULL,
 "livemode" BOOLEAN NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'RECEIVED' CHECK ("state" IN ('RECEIVED','SUBMITTING','UNKNOWN','SETTLED','REVIEW')),
 "submittedAt" TIMESTAMP(3),
 "claimedAt" TIMESTAMP(3),
 "taxTransactionId" TEXT,
 "taxEvidence" JSONB,
 "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ManualCheckoutSettlement_settled_check" CHECK ("state" != 'SETTLED' OR ("taxTransactionId" IS NOT NULL AND "taxEvidence" IS NOT NULL))
);
CREATE UNIQUE INDEX "ManualCheckoutSettlement_checkoutId_key" ON "ManualCheckoutSettlement"("checkoutId");
CREATE UNIQUE INDEX "ManualCheckoutSettlement_taxTransactionId_key" ON "ManualCheckoutSettlement"("taxTransactionId");
CREATE UNIQUE INDEX "ManualSettlement_receipt_reference_key" ON "ManualCheckoutSettlement"("livemode","accountId","method","reference");
CREATE INDEX "ManualCheckoutSettlement_state_claimedAt_idx" ON "ManualCheckoutSettlement"("state","claimedAt");
