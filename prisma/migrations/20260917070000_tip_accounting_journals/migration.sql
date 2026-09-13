CREATE TABLE "QboTipJournal" (
 "id" TEXT PRIMARY KEY, "tipId" TEXT NOT NULL REFERENCES "DeliveryTip"("id") ON DELETE RESTRICT,
 "sequence" INTEGER NOT NULL CHECK ("sequence">0), "mode" TEXT NOT NULL CHECK ("mode" IN ('sandbox','live')), "realm" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','SUBMITTING','UNKNOWN','POSTED','CANCELED')),
 "requestHash" TEXT NOT NULL, "docNumber" TEXT NOT NULL, "source" JSONB NOT NULL, "balances" JSONB NOT NULL, "mapping" JSONB NOT NULL, "payload" JSONB NOT NULL,
 "externalId" TEXT, "submittedAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3), "reconciliationIssue" TEXT, "recoveryCheckedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "QboTipJournal_posted" CHECK ("status" != 'POSTED' OR ("externalId" IS NOT NULL AND "confirmedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "QboTipJournal_tipId_sequence_key" ON "QboTipJournal"("tipId","sequence");
CREATE UNIQUE INDEX "QboTipJournal_mode_realm_docNumber_key" ON "QboTipJournal"("mode","realm","docNumber");
CREATE UNIQUE INDEX "QboTipJournal_mode_realm_externalId_key" ON "QboTipJournal"("mode","realm","externalId");

CREATE FUNCTION guard_tip_journal_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tip journal history is permanent'; END IF;
 IF ROW(OLD."id", OLD."tipId", OLD."sequence", OLD."mode", OLD."realm", OLD."requestHash", OLD."docNumber", OLD."source", OLD."balances", OLD."mapping", OLD."payload", OLD."createdAt") IS DISTINCT FROM ROW(NEW."id", NEW."tipId", NEW."sequence", NEW."mode", NEW."realm", NEW."requestHash", NEW."docNumber", NEW."source", NEW."balances", NEW."mapping", NEW."payload", NEW."createdAt") OR (OLD."externalId" IS NOT NULL AND OLD."externalId" IS DISTINCT FROM NEW."externalId") OR (OLD."confirmedAt" IS NOT NULL AND OLD."confirmedAt" IS DISTINCT FROM NEW."confirmedAt") OR (OLD."submittedAt" IS NOT NULL AND OLD."submittedAt" IS DISTINCT FROM NEW."submittedAt") OR (OLD."status"='POSTED' AND NEW."status"!='POSTED') OR (OLD."status"='CANCELED' AND NEW."status"!='CANCELED') OR (OLD."status" IN ('SUBMITTING','UNKNOWN') AND NEW."status" IN ('DRAFT','CANCELED')) THEN RAISE EXCEPTION 'Tip journal source and submitted history are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tip_journal_history BEFORE UPDATE OR DELETE ON "QboTipJournal" FOR EACH ROW EXECUTE FUNCTION guard_tip_journal_history();
