CREATE TABLE "QboReceiptExport" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT,
 "adjustmentId" TEXT REFERENCES "RefundAdjustment"("id") ON DELETE RESTRICT,
 "parentSaleId" TEXT REFERENCES "QboReceiptExport"("id") ON DELETE RESTRICT,
 "sourceKey" TEXT NOT NULL, "entity" TEXT NOT NULL CHECK ("entity" IN ('SalesReceipt','RefundReceipt')),
 "mode" TEXT NOT NULL CHECK ("mode" IN ('sandbox','live')), "realm" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','SUBMITTING','UNKNOWN','POSTED','CANCELED')),
 "docNumber" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "source" JSONB NOT NULL, "mapping" JSONB NOT NULL, "payload" JSONB NOT NULL,
 "externalId" TEXT, "submittedAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3),
 "recoveryCheckedAt" TIMESTAMP(3), "reconciliationIssue" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (("adjustmentId" IS NULL AND "parentSaleId" IS NULL AND "sourceKey" = 'sale:' || "orderId" AND "entity"='SalesReceipt') OR
        ("adjustmentId" IS NOT NULL AND "parentSaleId" IS NOT NULL AND "sourceKey" = 'refund:' || "adjustmentId" AND "entity"='RefundReceipt')),
 CHECK (("status" = 'POSTED' AND "externalId" IS NOT NULL AND "confirmedAt" IS NOT NULL) OR ("status" <> 'POSTED' AND "externalId" IS NULL AND "confirmedAt" IS NULL)),
 CHECK (("status" IN ('SUBMITTING','UNKNOWN','POSTED')) = ("submittedAt" IS NOT NULL)),
 CHECK (("source"->'sale'->>'orderId') IS NOT DISTINCT FROM "orderId"),
 CHECK (("payload"->>'entity') IS NOT DISTINCT FROM "entity"),
 CHECK (("payload"->'payload'->>'DocNumber') IS NOT DISTINCT FROM "docNumber"),
 CHECK (("payload"->>'sourceId') IS NOT DISTINCT FROM COALESCE("adjustmentId","orderId")),
 CHECK (("entity"='SalesReceipt' AND "docNumber" ~ '^DS[a-f0-9]{19}$') OR ("entity"='RefundReceipt' AND "docNumber" ~ '^DR[a-f0-9]{19}$'))
);
CREATE UNIQUE INDEX "QboReceiptExport_mode_realm_docNumber_key" ON "QboReceiptExport"("mode","realm","docNumber");
CREATE UNIQUE INDEX "QboReceiptExport_mode_realm_entity_externalId_key" ON "QboReceiptExport"("mode","realm","entity","externalId");
CREATE UNIQUE INDEX "QboReceiptExport_one_active_source" ON "QboReceiptExport"("sourceKey") WHERE "status" <> 'CANCELED';
CREATE INDEX "QboReceiptExport_sourceKey_status_idx" ON "QboReceiptExport"("sourceKey","status");
CREATE INDEX "QboReceiptExport_mode_realm_status_recoveryCheckedAt_idx" ON "QboReceiptExport"("mode","realm","status","recoveryCheckedAt");
CREATE FUNCTION dd_preserve_qbo_receipt_export() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Receipt accounting history cannot be deleted'; END IF;
 IF (NEW."id",NEW."orderId",NEW."adjustmentId",NEW."parentSaleId",NEW."sourceKey",NEW."entity",NEW."mode",NEW."realm",NEW."docNumber",NEW."requestHash",NEW."source",NEW."mapping",NEW."payload",NEW."createdAt") IS DISTINCT FROM (OLD."id",OLD."orderId",OLD."adjustmentId",OLD."parentSaleId",OLD."sourceKey",OLD."entity",OLD."mode",OLD."realm",OLD."docNumber",OLD."requestHash",OLD."source",OLD."mapping",OLD."payload",OLD."createdAt") THEN RAISE EXCEPTION 'Prepared receipt is immutable'; END IF;
 IF OLD."status" <> NEW."status" AND NOT ((OLD."status"='DRAFT' AND NEW."status" IN ('SUBMITTING','CANCELED')) OR (OLD."status"='SUBMITTING' AND NEW."status" IN ('UNKNOWN','POSTED')) OR (OLD."status"='UNKNOWN' AND NEW."status"='POSTED')) THEN RAISE EXCEPTION 'Receipt status cannot move backwards'; END IF;
 IF (OLD."externalId" IS NOT NULL AND NEW."externalId" IS DISTINCT FROM OLD."externalId") OR (OLD."submittedAt" IS NOT NULL AND NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt") OR (OLD."confirmedAt" IS NOT NULL AND NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt") THEN RAISE EXCEPTION 'Receipt evidence is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "QboReceiptExport_preserve" BEFORE UPDATE OR DELETE ON "QboReceiptExport" FOR EACH ROW EXECUTE FUNCTION dd_preserve_qbo_receipt_export();
CREATE FUNCTION dd_validate_qbo_receipt_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."adjustmentId" IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM "RefundAdjustment" a JOIN "RefundRequest" r ON r.id=a."requestId"
   JOIN "QboReceiptExport" p ON p.id=NEW."parentSaleId"
   WHERE a.id=NEW."adjustmentId" AND a.kind='SETTLEMENT' AND a."cashCents">0 AND a."providerRefundId" IS NOT NULL
     AND r."orderId"=NEW."orderId" AND p."orderId"=NEW."orderId" AND p."entity"='SalesReceipt'
     AND p.status='POSTED' AND p."reconciliationIssue" IS NULL AND p.mode=NEW.mode AND p.realm=NEW.realm AND p.mapping=NEW.mapping
 ) THEN RAISE EXCEPTION 'Refund receipt requires its posted original sale and original company mapping'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "QboReceiptExport_source" BEFORE INSERT ON "QboReceiptExport" FOR EACH ROW EXECUTE FUNCTION dd_validate_qbo_receipt_source();
