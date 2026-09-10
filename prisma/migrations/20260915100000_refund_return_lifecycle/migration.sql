CREATE TYPE "RefundRequestStatus" AS ENUM ('PREPARED', 'SUBMITTING', 'UNKNOWN', 'PENDING', 'REQUIRES_ACTION', 'SUCCEEDED', 'FAILED', 'CANCELED');
CREATE TYPE "StockReturnCondition" AS ENUM ('SELLABLE', 'DAMAGED');

CREATE TABLE "RefundRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "livemode" BOOLEAN NOT NULL,
  "providerRefundId" TEXT,
  "status" "RefundRequestStatus" NOT NULL DEFAULT 'PREPARED',
  "lastError" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RefundRequest_amountCents_check" CHECK ("amountCents" > 0),
  CONSTRAINT "RefundRequest_currency_check" CHECK (char_length("currency") BETWEEN 3 AND 12),
  CONSTRAINT "RefundRequest_reason_check" CHECK (char_length("reason") BETWEEN 10 AND 500)
);

CREATE TABLE "RefundRequestLine" (
  "id" TEXT NOT NULL,
  "refundRequestId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "netCents" INTEGER NOT NULL,
  "taxCents" INTEGER NOT NULL,
  "rewardCents" INTEGER NOT NULL,
  CONSTRAINT "RefundRequestLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RefundRequestLine_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "RefundRequestLine_amounts_check" CHECK ("netCents" >= 0 AND "taxCents" >= 0 AND "rewardCents" >= 0)
);

CREATE TABLE "RefundRequestEvent" (
  "id" TEXT NOT NULL,
  "refundRequestId" TEXT NOT NULL,
  "providerEventId" TEXT,
  "type" TEXT NOT NULL,
  "status" "RefundRequestStatus" NOT NULL,
  "evidenceJson" JSONB,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefundRequestEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockReturn" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockReturn_reason_check" CHECK (char_length("reason") BETWEEN 10 AND 500)
);

CREATE TABLE "StockReturnLine" (
  "id" TEXT NOT NULL,
  "stockReturnId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "condition" "StockReturnCondition" NOT NULL,
  CONSTRAINT "StockReturnLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockReturnLine_quantity_check" CHECK ("quantity" > 0)
);

ALTER TABLE "Refund" ADD COLUMN "requestId" TEXT;

CREATE UNIQUE INDEX "RefundRequest_requestKey_key" ON "RefundRequest"("requestKey");
CREATE UNIQUE INDEX "RefundRequest_providerRefundId_key" ON "RefundRequest"("providerRefundId");
CREATE INDEX "RefundRequest_orderId_createdAt_idx" ON "RefundRequest"("orderId", "createdAt");
CREATE INDEX "RefundRequest_paymentId_status_idx" ON "RefundRequest"("paymentId", "status");
CREATE INDEX "RefundRequest_status_updatedAt_idx" ON "RefundRequest"("status", "updatedAt");
CREATE UNIQUE INDEX "RefundRequestLine_refundRequestId_orderItemId_key" ON "RefundRequestLine"("refundRequestId", "orderItemId");
CREATE INDEX "RefundRequestLine_orderItemId_idx" ON "RefundRequestLine"("orderItemId");
CREATE UNIQUE INDEX "RefundRequestEvent_providerEventId_key" ON "RefundRequestEvent"("providerEventId");
CREATE INDEX "RefundRequestEvent_refundRequestId_createdAt_idx" ON "RefundRequestEvent"("refundRequestId", "createdAt");
CREATE UNIQUE INDEX "StockReturn_requestKey_key" ON "StockReturn"("requestKey");
CREATE INDEX "StockReturn_orderId_createdAt_idx" ON "StockReturn"("orderId", "createdAt");
CREATE UNIQUE INDEX "StockReturnLine_stockReturnId_orderItemId_key" ON "StockReturnLine"("stockReturnId", "orderItemId");
CREATE INDEX "StockReturnLine_orderItemId_idx" ON "StockReturnLine"("orderItemId");
CREATE UNIQUE INDEX "Refund_requestId_key" ON "Refund"("requestId");

ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundRequestLine" ADD CONSTRAINT "RefundRequestLine_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundRequestLine" ADD CONSTRAINT "RefundRequestLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundRequestEvent" ADD CONSTRAINT "RefundRequestEvent_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReturn" ADD CONSTRAINT "StockReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReturn" ADD CONSTRAINT "StockReturn_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReturnLine" ADD CONSTRAINT "StockReturnLine_stockReturnId_fkey" FOREIGN KEY ("stockReturnId") REFERENCES "StockReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReturnLine" ADD CONSTRAINT "StockReturnLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION dd_preserve_refund_events() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Refund request events are append-only; add a compensating event';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dd_refund_event_append_only"
BEFORE UPDATE OR DELETE ON "RefundRequestEvent"
FOR EACH ROW EXECUTE FUNCTION dd_preserve_refund_events();
