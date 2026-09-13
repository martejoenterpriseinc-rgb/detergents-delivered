CREATE TABLE "FinancialClaimReview" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('TIP_REFUND','MANUAL_REFUND_TAX','MANUAL_CHECKOUT_TAX')),
  "claimId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL CHECK ("sourceHash" ~ '^[a-f0-9]{64}$'),
  "sourceJson" JSONB NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "evidenceSha256" TEXT NOT NULL CHECK ("evidenceSha256" ~ '^[a-f0-9]{64}$'),
  "providerCase" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "reviewedThrough" TIMESTAMP(3) NOT NULL,
  "proposedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decision" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("decision" IN ('PENDING','APPROVED','REJECTED')),
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionReason" TEXT,
  CHECK (("decision" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL AND "decisionReason" IS NULL)
    OR ("decision" <> 'PENDING' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL AND length("decisionReason") >= 10)),
  CHECK ("decision" <> 'APPROVED' OR "decidedById" <> "proposedById")
);
CREATE INDEX "FinancialClaimReview_kind_claimId_createdAt_idx" ON "FinancialClaimReview"("kind", "claimId", "createdAt");
CREATE UNIQUE INDEX "FinancialClaimReview_one_approval" ON "FinancialClaimReview"("kind", "claimId") WHERE "decision" = 'APPROVED';
CREATE FUNCTION dd_protect_claim_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Financial claim reviews cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."decision" <> 'PENDING' THEN RAISE EXCEPTION 'Review must be proposed first'; END IF;
  ELSE
    IF OLD."decision" <> 'PENDING' OR NEW."decision" = 'PENDING'
       OR (to_jsonb(OLD) - ARRAY['decision','decidedById','decidedAt','decisionReason']) IS DISTINCT FROM
          (to_jsonb(NEW) - ARRAY['decision','decidedById','decidedAt','decisionReason']) THEN
      RAISE EXCEPTION 'Financial claim review evidence is immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dd_claim_review_immutable BEFORE INSERT OR UPDATE OR DELETE ON "FinancialClaimReview"
FOR EACH ROW EXECUTE FUNCTION dd_protect_claim_review();
ALTER TABLE "TipRefundRequest" DROP CONSTRAINT "TipRefundRequest_state_check";
ALTER TABLE "TipRefundRequest" ADD CONSTRAINT "TipRefundRequest_state_check"
CHECK ("state" IN ('SUBMITTING','UNKNOWN','PENDING','SUCCEEDED','FAILED','CANCELED','NOT_CREATED'));
ALTER TABLE "TipRefundRequest" DROP CONSTRAINT "TipRefundRequest_result_check";
ALTER TABLE "TipRefundRequest" ADD CONSTRAINT "TipRefundRequest_result_check"
CHECK (("state" = 'NOT_CREATED' AND "providerRefundId" IS NULL) OR "state" IN ('SUBMITTING','UNKNOWN') OR "providerRefundId" IS NOT NULL);
CREATE FUNCTION dd_require_non_creation_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."state" = 'NOT_CREATED' AND NOT EXISTS (
    SELECT 1 FROM "FinancialClaimReview" r WHERE r."kind" = 'TIP_REFUND' AND r."claimId" = NEW.id AND r."decision" = 'APPROVED'
    AND r."sourceJson"->>'requestHash' = NEW."requestHash"
    AND r."sourceJson"->>'accountId' = NEW."accountId"
    AND (r."sourceJson"->>'live')::boolean = NEW."livemode"
    AND r."sourceJson"->>'paymentIntentId' = NEW."paymentIntentId"
    AND (r."sourceJson"->>'amountCents')::integer = NEW."amountCents"
    AND (r."sourceJson"->>'submittedAt')::timestamp = NEW."submittedAt"
  ) THEN RAISE EXCEPTION 'Reviewed non-creation evidence required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dd_tip_non_creation_review BEFORE INSERT OR UPDATE ON "TipRefundRequest"
FOR EACH ROW EXECUTE FUNCTION dd_require_non_creation_review();
