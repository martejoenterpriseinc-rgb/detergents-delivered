CREATE TABLE "ManualPaymentApproval" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "maxOrderCents" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManualPaymentApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualPaymentApproval_method_check" CHECK ("method" IN ('CASH', 'ZELLE')),
  CONSTRAINT "ManualPaymentApproval_amount_check" CHECK ("maxOrderCents" > 0 AND "maxOrderCents" <= 1000000),
  CONSTRAINT "ManualPaymentApproval_version_check" CHECK ("version" > 0),
  CONSTRAINT "ManualPaymentApproval_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManualPaymentApproval_customerId_method_key" ON "ManualPaymentApproval"("customerId", "method");
