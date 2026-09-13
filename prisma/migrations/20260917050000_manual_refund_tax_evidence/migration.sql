CREATE UNIQUE INDEX "RefundRequestEvent_one_manual_tax" ON "RefundRequestEvent"("refundRequestId") WHERE type='manual-refund.tax.verified';
-- Preserve the original sale, original mapping, posted-state and company requirements.
CREATE OR REPLACE FUNCTION dd_validate_qbo_receipt_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."adjustmentId" IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM "RefundAdjustment" a JOIN "RefundRequest" r ON r.id=a."requestId"
   JOIN "QboReceiptExport" p ON p.id=NEW."parentSaleId"
   WHERE a.id=NEW."adjustmentId" AND a.kind='SETTLEMENT' AND a."cashCents">0
     AND (a."providerRefundId" IS NOT NULL OR (
       EXISTS (SELECT 1 FROM "Payment" pay WHERE pay.id=r."paymentId" AND pay.provider='MANUAL')
       AND EXISTS (SELECT 1 FROM "RefundRequestEvent" e WHERE e."refundRequestId"=r.id AND e.type='manual-refund.returned' AND e."verifiedAt" IS NOT NULL)
       AND EXISTS (SELECT 1 FROM "RefundRequestEvent" e WHERE e."refundRequestId"=r.id AND e.type='manual-refund.tax.verified' AND e."verifiedAt" IS NOT NULL)
     ))
     AND r."orderId"=NEW."orderId" AND p."orderId"=NEW."orderId" AND p."entity"='SalesReceipt'
     AND p.status='POSTED' AND p."reconciliationIssue" IS NULL AND p.mode=NEW.mode AND p.realm=NEW.realm AND p.mapping=NEW.mapping
 ) THEN RAISE EXCEPTION 'Refund receipt requires its posted original sale and original company mapping'; END IF;
 RETURN NEW; END $$;
