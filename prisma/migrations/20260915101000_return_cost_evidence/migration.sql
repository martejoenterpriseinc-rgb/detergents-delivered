ALTER TABLE "StockReturnLine" ADD COLUMN "costEvidence" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StockReturnLine" ALTER COLUMN "costEvidence" DROP DEFAULT;

CREATE TRIGGER "StockReturn_immutable"
BEFORE UPDATE OR DELETE ON "StockReturn"
FOR EACH ROW EXECUTE FUNCTION dd_preserve_refund_events();

CREATE TRIGGER "StockReturnLine_immutable"
BEFORE UPDATE OR DELETE ON "StockReturnLine"
FOR EACH ROW EXECUTE FUNCTION dd_preserve_refund_events();
