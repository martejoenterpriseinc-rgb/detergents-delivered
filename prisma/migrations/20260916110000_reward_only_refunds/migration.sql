ALTER TABLE "RefundRequest" DROP CONSTRAINT "RefundRequest_amountCents_check";
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_amountCents_check" CHECK ("amountCents" >= 0);
ALTER TABLE "RefundAdjustment" ALTER COLUMN "providerRefundId" DROP NOT NULL;
ALTER TABLE "RefundAdjustment" DROP CONSTRAINT "RefundAdjustment_kind_check";
ALTER TABLE "RefundAdjustment" ADD CONSTRAINT "RefundAdjustment_kind_check" CHECK ("kind" IN ('SETTLEMENT','COMPENSATION','REWARD_ONLY'));
ALTER TABLE "RefundAdjustment" DROP CONSTRAINT "RefundAdjustment_signs";
ALTER TABLE "RefundAdjustment" ADD CONSTRAINT "RefundAdjustment_signs" CHECK (
 ("kind" = 'SETTLEMENT' AND "cashCents" > 0 AND "netCents" >= 0 AND "taxCents" >= 0 AND "rewardCents" >= 0 AND "providerRefundId" IS NOT NULL) OR
 ("kind" = 'COMPENSATION' AND "cashCents" < 0 AND "netCents" <= 0 AND "taxCents" <= 0 AND "rewardCents" <= 0 AND "providerRefundId" IS NOT NULL) OR
 ("kind" = 'REWARD_ONLY' AND "cashCents" = 0 AND "netCents" = 0 AND "taxCents" = 0 AND "rewardCents" > 0 AND "providerRefundId" IS NULL AND "balanceTransactionId" IS NULL AND "failureBalanceTransactionId" IS NULL AND "taxEvidenceStatus" = 'NOT_APPLICABLE')
);
