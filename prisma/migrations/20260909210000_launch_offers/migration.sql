BEGIN;
ALTER TABLE "Customer" ADD COLUMN "purchaseApprovedAt" TIMESTAMP(3);
ALTER TABLE "Address" ADD COLUMN "validatedAt" TIMESTAMP(3), ADD COLUMN "validationSource" TEXT;
ALTER TABLE "Product" ADD COLUMN "loadKind" TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE "Product" ADD CONSTRAINT "Product_loadKind_check" CHECK ("loadKind" IN ('OTHER','DETERGENT','SCENT_BEADS'));
ALTER TABLE "Vehicle" ADD COLUMN "capacityUnits" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "detergentBucketLimit" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "scentBeadBucketLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_load_limits_check" CHECK ("capacityUnits" >= 0 AND "detergentBucketLimit" >= 0 AND "scentBeadBucketLimit" >= 0);
ALTER TABLE "Promotion" ADD COLUMN "minimumPurchaseCents" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "maximumDiscountCents" INTEGER, ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'ALL',
 ADD COLUMN "allowRewards" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "startsOn" TEXT, ADD COLUMN "endsOn" TEXT;
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_new_terms_check" CHECK
 ("minimumPurchaseCents" >= 0 AND ("maximumDiscountCents" IS NULL OR "maximumDiscountCents" > 0) AND "audience" IN ('ALL','FIRST_ORDER','REFERRED') AND "version" >= 0);
COMMIT;
