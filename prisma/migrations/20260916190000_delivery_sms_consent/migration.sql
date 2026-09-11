CREATE TABLE "SmsConsent" (
 "id" TEXT PRIMARY KEY, "customerId" TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "environment" TEXT NOT NULL CHECK ("environment" IN ('sandbox','live')),
 "accountSid" TEXT NOT NULL, "sender" TEXT NOT NULL, "phone" TEXT NOT NULL,
 "timezone" TEXT NOT NULL, "consentVersion" TEXT NOT NULL,
 "codeHash" TEXT NOT NULL UNIQUE, "state" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("state" IN ('PENDING','ACTIVE','REVOKED')),
 "expiresAt" TIMESTAMP(3) NOT NULL, "activatedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("state"='REVOKED') = ("revokedAt" IS NOT NULL)), CHECK ("state"<>'ACTIVE' OR "activatedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "SmsConsent_one_current" ON "SmsConsent"("customerId","environment") WHERE "state"<>'REVOKED';
CREATE INDEX "SmsConsent_customerId_environment_createdAt_idx" ON "SmsConsent"("customerId","environment","createdAt");
CREATE INDEX "SmsConsent_environment_accountSid_phone_state_idx" ON "SmsConsent"("environment","accountSid","phone","state");
CREATE TABLE "SmsInboundEvent" ("id" TEXT PRIMARY KEY, "eventHash" TEXT NOT NULL, "kind" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE FUNCTION dd_preserve_sms_consent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SMS consent history cannot be deleted'; END IF;
 IF (NEW."id",NEW."customerId",NEW."environment",NEW."accountSid",NEW."sender",NEW."phone",NEW."timezone",NEW."consentVersion",NEW."codeHash",NEW."expiresAt",NEW."createdAt") IS DISTINCT FROM (OLD."id",OLD."customerId",OLD."environment",OLD."accountSid",OLD."sender",OLD."phone",OLD."timezone",OLD."consentVersion",OLD."codeHash",OLD."expiresAt",OLD."createdAt") OR
 (OLD."state"<>NEW."state" AND NOT ((OLD."state"='PENDING' AND NEW."state" IN ('ACTIVE','REVOKED')) OR (OLD."state"='ACTIVE' AND NEW."state"='REVOKED'))) OR
 (OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt") OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN RAISE EXCEPTION 'SMS consent evidence is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "SmsConsent_preserve" BEFORE UPDATE OR DELETE ON "SmsConsent" FOR EACH ROW EXECUTE FUNCTION dd_preserve_sms_consent();
CREATE TRIGGER "SmsInboundEvent_preserve" BEFORE UPDATE OR DELETE ON "SmsInboundEvent" FOR EACH ROW EXECUTE FUNCTION dd_preserve_refund_events();
