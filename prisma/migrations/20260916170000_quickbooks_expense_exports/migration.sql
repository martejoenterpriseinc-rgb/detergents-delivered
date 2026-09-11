CREATE TABLE "QboExpenseExport" (
 "id" TEXT PRIMARY KEY, "expenseId" TEXT NOT NULL REFERENCES "Expense"("id") ON DELETE RESTRICT,
 "mode" TEXT NOT NULL CHECK ("mode" IN ('sandbox','live')), "realm" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','SUBMITTING','UNKNOWN','POSTED','CANCELED')),
 "docNumber" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "source" JSONB NOT NULL, "mapping" JSONB NOT NULL, "payload" JSONB NOT NULL,
 "externalId" TEXT, "submittedAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (("status" = 'POSTED' AND "externalId" IS NOT NULL AND "confirmedAt" IS NOT NULL) OR ("status" <> 'POSTED' AND "externalId" IS NULL AND "confirmedAt" IS NULL)),
 CHECK (("status" IN ('SUBMITTING','UNKNOWN','POSTED')) = ("submittedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "QboExpenseExport_mode_realm_docNumber_key" ON "QboExpenseExport"("mode","realm","docNumber");
CREATE UNIQUE INDEX "QboExpenseExport_mode_realm_externalId_key" ON "QboExpenseExport"("mode","realm","externalId");
CREATE UNIQUE INDEX "QboExpenseExport_one_active_expense" ON "QboExpenseExport"("expenseId") WHERE "status" <> 'CANCELED';
CREATE INDEX "QboExpenseExport_expenseId_status_idx" ON "QboExpenseExport"("expenseId","status");
CREATE FUNCTION dd_preserve_qbo_expense_export() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accounting export history cannot be deleted'; END IF;
 IF (NEW."id",NEW."expenseId",NEW."mode",NEW."realm",NEW."docNumber",NEW."requestHash",NEW."source",NEW."mapping",NEW."payload",NEW."createdAt") IS DISTINCT FROM (OLD."id",OLD."expenseId",OLD."mode",OLD."realm",OLD."docNumber",OLD."requestHash",OLD."source",OLD."mapping",OLD."payload",OLD."createdAt") THEN RAISE EXCEPTION 'Prepared accounting export is immutable'; END IF;
 IF OLD."status" <> NEW."status" AND NOT ((OLD."status"='DRAFT' AND NEW."status" IN ('SUBMITTING','CANCELED')) OR (OLD."status"='SUBMITTING' AND NEW."status" IN ('UNKNOWN','POSTED')) OR (OLD."status"='UNKNOWN' AND NEW."status"='POSTED')) THEN RAISE EXCEPTION 'Accounting export status cannot move backwards'; END IF;
 IF (OLD."externalId" IS NOT NULL AND NEW."externalId" IS DISTINCT FROM OLD."externalId") OR (OLD."submittedAt" IS NOT NULL AND NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt") OR (OLD."confirmedAt" IS NOT NULL AND NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt") THEN RAISE EXCEPTION 'Accounting export evidence is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "QboExpenseExport_preserve" BEFORE UPDATE OR DELETE ON "QboExpenseExport" FOR EACH ROW EXECUTE FUNCTION dd_preserve_qbo_expense_export();
CREATE FUNCTION dd_freeze_exported_expense() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (OLD."qboTxnId" IS NOT NULL AND NEW."qboTxnId" IS DISTINCT FROM OLD."qboTxnId") OR
 ((NEW."categoryId",NEW."amountCents",NEW."currency",NEW."incurredOn",NEW."memo") IS DISTINCT FROM (OLD."categoryId",OLD."amountCents",OLD."currency",OLD."incurredOn",OLD."memo") AND EXISTS (SELECT 1 FROM "QboExpenseExport" WHERE "expenseId"=OLD."id" AND "status"<>'CANCELED')) THEN RAISE EXCEPTION 'Cancel an unsubmitted draft or reconcile accounting before changing this expense'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "Expense_qbo_preserve" BEFORE UPDATE ON "Expense" FOR EACH ROW EXECUTE FUNCTION dd_freeze_exported_expense();
