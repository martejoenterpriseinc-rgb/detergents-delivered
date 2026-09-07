-- CreateEnum
CREATE TYPE "PriceKind" AS ENUM ('RETAIL', 'SUBSCRIPTION', 'SALE');

-- AlterEnum
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'ORDERED';

-- AlterEnum
ALTER TYPE "InventoryTxnType" ADD VALUE 'PURCHASE_RECEIPT';
ALTER TYPE "InventoryTxnType" ADD VALUE 'CUSTOMER_RESERVATION';
ALTER TYPE "InventoryTxnType" ADD VALUE 'RESERVATION_RELEASE';
ALTER TYPE "InventoryTxnType" ADD VALUE 'ROUTE_ALLOCATION';
ALTER TYPE "InventoryTxnType" ADD VALUE 'ROUTE_LOAD';
ALTER TYPE "InventoryTxnType" ADD VALUE 'DELIVERY';
ALTER TYPE "InventoryTxnType" ADD VALUE 'LOSS';
ALTER TYPE "InventoryTxnType" ADD VALUE 'TRANSFER';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "allowPreorder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deliveryCapacityUnits" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxCategory" TEXT,
ADD COLUMN     "websiteVisible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "casePack" INTEGER,
ADD COLUMN     "deliveryCapacityUnits" INTEGER,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "heightIn" DECIMAL(12,3),
ADD COLUMN     "lengthIn" DECIMAL(12,3),
ADD COLUMN     "reorderPoint" INTEGER,
ADD COLUMN     "reorderQty" INTEGER,
ADD COLUMN     "taxCategory" TEXT,
ADD COLUMN     "uom" TEXT,
ADD COLUMN     "websiteVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "weightUnit" TEXT,
ADD COLUMN     "weightValue" DECIMAL(12,3),
ADD COLUMN     "widthIn" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "ProductPrice" ADD COLUMN     "kind" "PriceKind" NOT NULL DEFAULT 'RETAIL';

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'US',
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "region" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "feeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "feeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "freightCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otherCostCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "createdByUserId" TEXT;

-- AlterTable
ALTER TABLE "ReceiptItem" ADD COLUMN     "costDiscrepancyNotes" TEXT,
ADD COLUMN     "quantityDamaged" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quantityOverage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quantityShortage" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "landedUnitCostCents" INTEGER;

-- CreateTable
CREATE TABLE "InventoryCostLayer" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "receiptItemId" TEXT,
    "quantityOriginal" INTEGER NOT NULL,
    "quantityRemaining" INTEGER NOT NULL,
    "landedUnitCostCents" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCostLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryCostLayer_productVariantId_receivedAt_idx" ON "InventoryCostLayer"("productVariantId", "receivedAt");

-- CreateIndex
CREATE INDEX "InventoryCostLayer_receiptItemId_idx" ON "InventoryCostLayer"("receiptItemId");

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

-- CreateIndex
DROP INDEX "Product_isActive_idx";
CREATE INDEX "Product_isActive_websiteVisible_idx" ON "Product"("isActive", "websiteVisible");

-- CreateIndex
CREATE INDEX "ProductVariant_sku_idx" ON "ProductVariant"("sku");

-- CreateIndex
DROP INDEX "ProductPrice_productVariantId_startsAt_idx";
CREATE INDEX "ProductPrice_productVariantId_kind_startsAt_idx" ON "ProductPrice"("productVariantId", "kind", "startsAt");

-- CreateIndex
CREATE INDEX "Vendor_name_idx" ON "Vendor"("name");

-- CreateIndex
CREATE INDEX "Receipt_number_idx" ON "Receipt"("number");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCostLayer" ADD CONSTRAINT "InventoryCostLayer_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCostLayer" ADD CONSTRAINT "InventoryCostLayer_receiptItemId_fkey" FOREIGN KEY ("receiptItemId") REFERENCES "ReceiptItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
