ALTER TABLE "Subscription" ALTER COLUMN "cadenceDays" DROP DEFAULT;
ALTER TABLE "Subscription" ALTER COLUMN "cadenceDays" DROP NOT NULL;
ALTER TABLE "Subscription"
 ADD COLUMN "cadenceMonths" INTEGER,
 ADD COLUMN "anchorDate" DATE,
 ADD COLUMN "cycleNumber" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "consentVersion" TEXT,
 ADD COLUMN "consentedAt" TIMESTAMP(3),
 ADD CONSTRAINT "Subscription_quarterly_consent" CHECK (
  "cadenceMonths" IS NULL OR ("cadenceMonths" = 3 AND "cadenceDays" IS NULL AND "anchorDate" IS NOT NULL AND "consentVersion" = 'quarterly-pay-at-purchase-v1' AND "consentedAt" IS NOT NULL)
 ),
 ADD CONSTRAINT "Subscription_version_cycle" CHECK ("version" >= 0 AND "cycleNumber" >= 1);
CREATE TABLE "SubscriptionEvent" (
 "id" TEXT PRIMARY KEY,
 "subscriptionId" TEXT NOT NULL REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestKey" TEXT NOT NULL UNIQUE,
 "requestHash" TEXT NOT NULL,
 "actorUserId" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx" ON "SubscriptionEvent"("subscriptionId", "createdAt");
CREATE TRIGGER "SubscriptionEvent_immutable" BEFORE UPDATE OR DELETE ON "SubscriptionEvent" FOR EACH ROW EXECUTE FUNCTION dd_preserve_refund_events();
