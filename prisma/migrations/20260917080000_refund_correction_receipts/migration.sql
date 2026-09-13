-- Extend receipt identity without rewriting any original sale/refund or migration.
DO $$ DECLARE c TEXT; BEGIN
 SELECT conname INTO STRICT c FROM pg_constraint WHERE conrelid='"QboReceiptExport"'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%sourceKey%';
 EXECUTE format('ALTER TABLE "QboReceiptExport" DROP CONSTRAINT %I',c);
END $$;
ALTER TABLE "QboReceiptExport" ADD CONSTRAINT "QboReceiptExport_source_identity" CHECK (
 ("adjustmentId" IS NULL AND "parentSaleId" IS NULL AND "sourceKey"='sale:'||"orderId" AND entity='SalesReceipt') OR
 ("adjustmentId" IS NOT NULL AND "parentSaleId" IS NOT NULL AND (("sourceKey"='refund:'||"adjustmentId" AND entity='RefundReceipt') OR ("sourceKey"='correction:'||"adjustmentId" AND entity='SalesReceipt'))));
CREATE UNIQUE INDEX "RefundAdjustment_one_tax_correction" ON "AuditLog"("entityId") WHERE "entityType"='RefundAdjustment' AND action='refund.tax-correction.verified';
CREATE OR REPLACE FUNCTION dd_validate_qbo_receipt_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."adjustmentId" IS NOT NULL AND NEW.entity='RefundReceipt' AND NOT EXISTS (
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
 IF NEW."adjustmentId" IS NOT NULL AND NEW.entity='SalesReceipt' AND NOT EXISTS (
 SELECT 1 FROM "RefundAdjustment" a JOIN "RefundRequest" r ON r.id=a."requestId"
 JOIN "RefundAdjustment" s ON s."requestId"=r.id AND s.kind='SETTLEMENT'
 JOIN "QboReceiptExport" original ON original."adjustmentId"=s.id AND original.status='POSTED' AND original.entity='RefundReceipt'
 JOIN "QboReceiptExport" sale ON sale.id=NEW."parentSaleId" AND sale.id=original."parentSaleId"
 WHERE a.id=NEW."adjustmentId" AND a.kind='COMPENSATION' AND a."cashCents"=-s."cashCents" AND a."taxCents"=-s."taxCents" AND a."netCents"=-s."netCents" AND a."failureBalanceTransactionId" IS NOT NULL AND r.status IN ('FAILED','CANCELED') AND r."orderId"=NEW."orderId" AND original.mode=NEW.mode AND original.realm=NEW.realm AND original.mapping=NEW.mapping AND (original."reconciliationIssue" IS NULL OR original."reconciliationIssue"='REFUND_COMPENSATION_REVIEW') AND sale.status='POSTED' AND sale."reconciliationIssue" IS NULL AND EXISTS (SELECT 1 FROM "AuditLog" e WHERE e."entityType"='RefundAdjustment' AND e."entityId"=a.id AND e.action='refund.tax-correction.verified')
 ) THEN RAISE EXCEPTION 'Correction requires verified compensation, tax correction and original posted refund'; END IF;
 RETURN NEW; END $$;
