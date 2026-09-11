CREATE TABLE "QboCostExport" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT,
 "returnId" TEXT REFERENCES "StockReturn"("id") ON DELETE RESTRICT,
 "parentSaleId" TEXT REFERENCES "QboCostExport"("id") ON DELETE RESTRICT,
 "sourceKey" TEXT NOT NULL,
 "mode" TEXT NOT NULL CHECK ("mode" IN ('sandbox','live')), "realm" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','SUBMITTING','UNKNOWN','POSTED','CANCELED')),
 "docNumber" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "source" JSONB NOT NULL, "mapping" JSONB NOT NULL, "payload" JSONB NOT NULL,
 "externalId" TEXT, "submittedAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3),
 "recoveryCheckedAt" TIMESTAMP(3), "reconciliationIssue" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (("returnId" IS NULL AND "parentSaleId" IS NULL AND "sourceKey" = 'sale:' || "orderId") OR ("returnId" IS NOT NULL AND "parentSaleId" IS NOT NULL AND "sourceKey" = 'return:' || "returnId")),
 CHECK (("status" = 'POSTED' AND "externalId" IS NOT NULL AND "confirmedAt" IS NOT NULL) OR ("status" <> 'POSTED' AND "externalId" IS NULL AND "confirmedAt" IS NULL)),
 CHECK (("status" IN ('SUBMITTING','UNKNOWN','POSTED')) = ("submittedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "QboCostExport_mode_realm_docNumber_key" ON "QboCostExport"("mode","realm","docNumber");
CREATE UNIQUE INDEX "QboCostExport_mode_realm_externalId_key" ON "QboCostExport"("mode","realm","externalId");
CREATE UNIQUE INDEX "QboCostExport_one_active_source" ON "QboCostExport"("sourceKey") WHERE "status" <> 'CANCELED';
CREATE INDEX "QboCostExport_sourceKey_status_idx" ON "QboCostExport"("sourceKey","status");
CREATE INDEX "QboCostExport_mode_realm_status_recoveryCheckedAt_idx" ON "QboCostExport"("mode","realm","status","recoveryCheckedAt");
CREATE FUNCTION dd_preserve_qbo_cost_export() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cost accounting history cannot be deleted'; END IF;
 IF (NEW."id",NEW."orderId",NEW."returnId",NEW."parentSaleId",NEW."sourceKey",NEW."mode",NEW."realm",NEW."docNumber",NEW."requestHash",NEW."source",NEW."mapping",NEW."payload",NEW."createdAt") IS DISTINCT FROM (OLD."id",OLD."orderId",OLD."returnId",OLD."parentSaleId",OLD."sourceKey",OLD."mode",OLD."realm",OLD."docNumber",OLD."requestHash",OLD."source",OLD."mapping",OLD."payload",OLD."createdAt") THEN RAISE EXCEPTION 'Prepared cost journal is immutable'; END IF;
 IF OLD."status" <> NEW."status" AND NOT ((OLD."status"='DRAFT' AND NEW."status" IN ('SUBMITTING','CANCELED')) OR (OLD."status"='SUBMITTING' AND NEW."status" IN ('UNKNOWN','POSTED')) OR (OLD."status"='UNKNOWN' AND NEW."status"='POSTED')) THEN RAISE EXCEPTION 'Cost journal status cannot move backwards'; END IF;
 IF (OLD."externalId" IS NOT NULL AND NEW."externalId" IS DISTINCT FROM OLD."externalId") OR (OLD."submittedAt" IS NOT NULL AND NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt") OR (OLD."confirmedAt" IS NOT NULL AND NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt") THEN RAISE EXCEPTION 'Cost journal evidence is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "QboCostExport_preserve" BEFORE UPDATE OR DELETE ON "QboCostExport" FOR EACH ROW EXECUTE FUNCTION dd_preserve_qbo_cost_export();
CREATE FUNCTION dd_validate_qbo_cost_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."returnId" IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM "StockReturn" r JOIN "QboCostExport" p ON p."id"=NEW."parentSaleId"
   WHERE r.id=NEW."returnId" AND r."orderId"=NEW."orderId" AND p."orderId"=NEW."orderId"
     AND p."returnId" IS NULL AND p.status='POSTED' AND p.mode=NEW.mode AND p.realm=NEW.realm AND p.mapping=NEW.mapping
 ) THEN RAISE EXCEPTION 'Return cost requires its posted sale in the same company and accounts'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "QboCostExport_source" BEFORE INSERT ON "QboCostExport" FOR EACH ROW EXECUTE FUNCTION dd_validate_qbo_cost_source();
