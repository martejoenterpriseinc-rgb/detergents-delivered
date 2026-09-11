CREATE TABLE "SmsDelivery" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "consentId" TEXT NOT NULL REFERENCES "SmsConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "environment" TEXT NOT NULL CHECK ("environment" IN ('sandbox','live')), "accountSid" TEXT NOT NULL, "sender" TEXT NOT NULL, "phone" TEXT NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('OUT_FOR_DELIVERY','DELIVERED')),
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SUBMITTING','UNKNOWN','QUEUED','SENT','DELIVERED','FAILED','SKIPPED')),
 "body" TEXT, "providerSid" TEXT UNIQUE, "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 5),
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "submittedAt" TIMESTAMP(3), "checkedAt" TIMESTAMP(3), "issue" TEXT,
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("providerSid" IS NULL OR ("body" IS NOT NULL AND "submittedAt" IS NOT NULL AND "attempts">0))
);
CREATE UNIQUE INDEX "SmsDelivery_orderId_kind_key" ON "SmsDelivery"("orderId","kind");
CREATE INDEX "SmsDelivery_environment_accountSid_status_nextAttemptAt_idx" ON "SmsDelivery"("environment","accountSid","status","nextAttemptAt");
CREATE TABLE "SmsDeliveryEvent" ("id" TEXT PRIMARY KEY,"deliveryId" TEXT NOT NULL REFERENCES "SmsDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE,"providerSid" TEXT NOT NULL,"status" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE FUNCTION dd_preserve_sms_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SMS delivery evidence cannot be deleted'; END IF;
 IF (NEW."id",NEW."orderId",NEW."consentId",NEW."environment",NEW."accountSid",NEW."sender",NEW."phone",NEW."kind",NEW."expiresAt",NEW."createdAt") IS DISTINCT FROM (OLD."id",OLD."orderId",OLD."consentId",OLD."environment",OLD."accountSid",OLD."sender",OLD."phone",OLD."kind",OLD."expiresAt",OLD."createdAt") OR
 (OLD."providerSid" IS NOT NULL AND NEW."providerSid" IS DISTINCT FROM OLD."providerSid") OR (OLD."body" IS NOT NULL AND NEW."body" IS DISTINCT FROM OLD."body") OR (OLD."submittedAt" IS NOT NULL AND NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt") OR (NEW."attempts"<OLD."attempts") OR
 (OLD."status" IN ('DELIVERED','FAILED','SKIPPED') AND NEW."status" IS DISTINCT FROM OLD."status") THEN RAISE EXCEPTION 'SMS delivery evidence is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "SmsDelivery_preserve" BEFORE UPDATE OR DELETE ON "SmsDelivery" FOR EACH ROW EXECUTE FUNCTION dd_preserve_sms_delivery();
CREATE TRIGGER "SmsDeliveryEvent_preserve" BEFORE UPDATE OR DELETE ON "SmsDeliveryEvent" FOR EACH ROW EXECUTE FUNCTION dd_preserve_refund_events();
