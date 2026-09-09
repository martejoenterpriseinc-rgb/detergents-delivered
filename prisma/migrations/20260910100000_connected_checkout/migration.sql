-- CreateTable
CREATE TABLE "CheckoutAttempt" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUOTED',
    "snapshot" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sessionExpiresAt" TIMESTAMP(3),
    "deliveryConfirmedAt" TIMESTAMP(3),
    "stripeSessionId" TEXT,
    "stripeCustomerId" TEXT,
    "stripeAccountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "orderId" TEXT,
    "vehicleId" TEXT,
    "zoneId" TEXT,
    "serviceDate" TEXT,
    "spaceUnits" INTEGER NOT NULL DEFAULT 0,
    "detergentBuckets" INTEGER NOT NULL DEFAULT 0,
    "scentBeadBuckets" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutCostAllocation" (
    "id" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "costLayerId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostCents" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'HELD',

    CONSTRAINT "CheckoutCostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutProviderEvent" (
    "id" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutAttempt_stripeSessionId_key" ON "CheckoutAttempt"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutAttempt_orderId_key" ON "CheckoutAttempt"("orderId");

-- CreateIndex
CREATE INDEX "CheckoutAttempt_state_updatedAt_idx" ON "CheckoutAttempt"("state", "updatedAt");

-- CreateIndex
CREATE INDEX "CheckoutAttempt_vehicleId_serviceDate_state_idx" ON "CheckoutAttempt"("vehicleId", "serviceDate", "state");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutAttempt_customerId_requestKey_key" ON "CheckoutAttempt"("customerId", "requestKey");

-- CreateIndex
CREATE INDEX "CheckoutCostAllocation_costLayerId_state_idx" ON "CheckoutCostAllocation"("costLayerId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutCostAllocation_checkoutId_costLayerId_key" ON "CheckoutCostAllocation"("checkoutId", "costLayerId");

-- AddForeignKey
ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "CheckoutAttempt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "CheckoutAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutCostAllocation" ADD CONSTRAINT "CheckoutCostAllocation_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "CheckoutAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutCostAllocation" ADD CONSTRAINT "CheckoutCostAllocation_costLayerId_fkey" FOREIGN KEY ("costLayerId") REFERENCES "InventoryCostLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutProviderEvent" ADD CONSTRAINT "CheckoutProviderEvent_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "CheckoutAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fail closed on invalid resource states; no existing business rows are modified.
ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "checkout_state_valid" CHECK ("state" IN ('QUOTED','PREPARING','OPEN','PROCESSING','PAID','EXPIRED','REVIEW','REFUNDED'));
ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "checkout_load_nonnegative" CHECK ("spaceUnits" >= 0 AND "detergentBuckets" >= 0 AND "scentBeadBuckets" >= 0);
ALTER TABLE "CheckoutCostAllocation" ADD CONSTRAINT "checkout_cost_valid" CHECK ("quantity" > 0 AND "unitCostCents" >= 0 AND "state" IN ('HELD','CONSUMED','RELEASED'));
