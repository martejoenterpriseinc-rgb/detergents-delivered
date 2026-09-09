-- AlterTable
ALTER TABLE "SitePage" ADD COLUMN     "draftJson" JSONB,
ADD COLUMN     "settingsJson" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SiteSection" ADD COLUMN     "presentationJson" JSONB;

-- CreateTable
CREATE TABLE "SiteRevision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteMedia" (
    "id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostalLocation" (
    "postalCode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "placeName" TEXT,
    "retryAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostalLocation_pkey" PRIMARY KEY ("postalCode")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteRevision_requestKey_key" ON "SiteRevision"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "SiteRevision_pageId_version_key" ON "SiteRevision"("pageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SiteMedia_sha256_key" ON "SiteMedia"("sha256");

-- AddForeignKey
ALTER TABLE "SiteRevision" ADD CONSTRAINT "SiteRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SitePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve existing copy and visibility while connecting the previous fixed slots
-- to the shared renderer. No ordering ZIPs or checkout settings are changed.
UPDATE "SiteSection" SET "type" = 'products' WHERE "sectionId" = 'featured' AND "type" = 'cta';
UPDATE "SiteSection" SET "type" = 'steps' WHERE "sectionId" = 'how-it-works' AND "type" = 'features';
UPDATE "SiteSection" SET "presentationJson" = '{"imageId":"builtin:hero","imageAlt":"Laundry essentials and folded towels prepared for home delivery"}'::jsonb WHERE "type" = 'hero' AND "presentationJson" IS NULL;
INSERT INTO "SiteSection" ("id", "pageId", "sectionId", "type", "title", "body", "badgeText", "visible", "sortOrder", "styleVariant", "createdAt", "updatedAt")
SELECT 'delivery-map-' || p."id", p."id", 'delivery-map', 'service-area', 'Is your neighborhood on the route?', 'Our delivery area grows as new ZIP codes join our local routes. Check your ZIP to get started.', 'Delivery availability', true,
  COALESCE((SELECT MAX(s."sortOrder") + 1 FROM "SiteSection" s WHERE s."pageId" = p."id"), 0), 'muted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SitePage" p WHERE p."slug" = 'home' AND NOT EXISTS (SELECT 1 FROM "SiteSection" s WHERE s."pageId" = p."id" AND (s."type" = 'service-area' OR s."sectionId" = 'delivery-map'));
