CREATE TABLE "DeliveryTip" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "deliveryAttemptId" TEXT NOT NULL REFERENCES "DeliveryAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "choice" TEXT NOT NULL, "percent" INTEGER,
 "baseCents" INTEGER NOT NULL, "amountCents" INTEGER NOT NULL,
 "taxCents" INTEGER, "totalCents" INTEGER,
 "currency" TEXT NOT NULL DEFAULT 'USD', "state" TEXT NOT NULL,
 "source" JSONB NOT NULL, "stripeAccountId" TEXT NOT NULL, "livemode" BOOLEAN NOT NULL,
 "taxCode" TEXT, "stripeSessionId" TEXT, "stripeCustomerId" TEXT, "paymentIntentId" TEXT,
 "expiresAt" TIMESTAMP(3) NOT NULL, "paidAt" TIMESTAMP(3), "recoveryCheckedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DeliveryTip_choice_check" CHECK (("choice"='DECLINE' AND "amountCents"=0 AND "percent" IS NULL) OR ("choice"='AMOUNT' AND "amountCents" BETWEEN 50 AND 50000 AND "percent" IS NULL) OR ("choice"='PERCENT' AND "amountCents" BETWEEN 50 AND 50000 AND "percent" BETWEEN 1 AND 100)),
 CONSTRAINT "DeliveryTip_state_check" CHECK ("state" IN ('DECLINED','SUBMITTING','OPEN','UNKNOWN','PAID','EXPIRED')),
 CONSTRAINT "DeliveryTip_base_check" CHECK ("baseCents">=0 AND "currency"='USD'),
 CONSTRAINT "DeliveryTip_paid_check" CHECK ("state"!='PAID' OR ("stripeSessionId" IS NOT NULL AND "stripeCustomerId" IS NOT NULL AND "paymentIntentId" IS NOT NULL AND "paidAt" IS NOT NULL AND "taxCents" IS NOT NULL AND "totalCents" IS NOT NULL AND "taxCents">=0 AND "totalCents"="amountCents"+"taxCents")),
 CONSTRAINT "DeliveryTip_decline_check" CHECK (("choice"='DECLINE')=("state"='DECLINED'))
);
CREATE UNIQUE INDEX "DeliveryTip_orderId_requestKey_key" ON "DeliveryTip"("orderId","requestKey");
CREATE UNIQUE INDEX "DeliveryTip_stripeSessionId_key" ON "DeliveryTip"("stripeSessionId");
CREATE UNIQUE INDEX "DeliveryTip_paymentIntentId_key" ON "DeliveryTip"("paymentIntentId");
CREATE UNIQUE INDEX "DeliveryTip_one_active_or_paid_order" ON "DeliveryTip"("orderId") WHERE "state" IN ('SUBMITTING','OPEN','UNKNOWN','PAID');
CREATE INDEX "DeliveryTip_state_recoveryCheckedAt_idx" ON "DeliveryTip"("state","recoveryCheckedAt");
CREATE UNIQUE INDEX "DeliveryTip_one_decline_order" ON "DeliveryTip"("orderId") WHERE "state"='DECLINED';
