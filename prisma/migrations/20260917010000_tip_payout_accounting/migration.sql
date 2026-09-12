CREATE TABLE "TipPayoutEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tipId" TEXT NOT NULL REFERENCES "DeliveryTip"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "driverUserId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('PAYMENT','REVERSAL')),
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0 AND "amountCents" <= 50000),
  "reference" TEXT NOT NULL,
  "paidOn" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "reversalOfId" TEXT REFERENCES "TipPayoutEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipPayoutEntry_kind_parent_check" CHECK (("kind" = 'PAYMENT' AND "reversalOfId" IS NULL) OR ("kind" = 'REVERSAL' AND "reversalOfId" IS NOT NULL))
);
CREATE UNIQUE INDEX "TipPayoutEntry_reversalOfId_key" ON "TipPayoutEntry"("reversalOfId");
CREATE UNIQUE INDEX "TipPayoutEntry_tipId_reference_key" ON "TipPayoutEntry"("tipId", "reference");
CREATE INDEX "TipPayoutEntry_driverUserId_paidOn_idx" ON "TipPayoutEntry"("driverUserId", "paidOn");
