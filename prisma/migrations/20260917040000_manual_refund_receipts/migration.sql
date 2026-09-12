-- Retain all existing refund rows and provider constraints. Manual settlements
-- require a separate, immutable returned-money event instead of a fabricated Stripe ID.
ALTER TABLE "RefundAdjustment" DROP CONSTRAINT "RefundAdjustment_signs";
ALTER TABLE "RefundAdjustment" ADD CONSTRAINT "RefundAdjustment_signs" CHECK (
 ("kind" = 'SETTLEMENT' AND "cashCents" > 0 AND "netCents" >= 0 AND "taxCents" >= 0 AND "rewardCents" >= 0) OR
 ("kind" = 'COMPENSATION' AND "cashCents" < 0 AND "netCents" <= 0 AND "taxCents" <= 0 AND "rewardCents" <= 0 AND "providerRefundId" IS NOT NULL) OR
 ("kind" = 'REWARD_ONLY' AND "cashCents" = 0 AND "netCents" = 0 AND "taxCents" = 0 AND "rewardCents" > 0 AND "providerRefundId" IS NULL AND "balanceTransactionId" IS NULL AND "failureBalanceTransactionId" IS NULL AND "taxEvidenceStatus" = 'NOT_APPLICABLE')
);
CREATE FUNCTION dd_validate_manual_refund_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.kind='SETTLEMENT' AND NEW."providerRefundId" IS NULL AND NOT EXISTS (
   SELECT 1 FROM "RefundRequest" r JOIN "Payment" p ON p.id=r."paymentId"
   JOIN "RefundRequestEvent" e ON e."refundRequestId"=r.id
   WHERE r.id=NEW."requestId" AND p.provider='MANUAL' AND p."orderId"=r."orderId"
     AND r."amountCents"=NEW."cashCents" AND r.currency=NEW.currency
     AND e.type='manual-refund.returned' AND e.status='SUCCEEDED' AND e."verifiedAt" IS NOT NULL
     AND e."providerEventId" LIKE 'dd:manual-refund:receipt:%'
     AND NEW."balanceTransactionId" IS NULL AND NEW."failureBalanceTransactionId" IS NULL
 ) THEN RAISE EXCEPTION 'Manual refund requires a verified returned-money receipt'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "RefundAdjustment_manual_source" BEFORE INSERT ON "RefundAdjustment"
 FOR EACH ROW EXECUTE FUNCTION dd_validate_manual_refund_adjustment();
CREATE UNIQUE INDEX "RefundRequestEvent_one_manual_return" ON "RefundRequestEvent"("refundRequestId") WHERE type='manual-refund.returned';
