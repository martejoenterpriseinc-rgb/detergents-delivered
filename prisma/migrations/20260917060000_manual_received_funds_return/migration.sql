-- Preserve original received-money records; returning an unfulfilled receipt is a separate audited action.
ALTER TABLE "ManualCheckoutSettlement" DROP CONSTRAINT "ManualCheckoutSettlement_state_check";
ALTER TABLE "ManualCheckoutSettlement" ADD CONSTRAINT "ManualCheckoutSettlement_state_check"
CHECK ("state" IN ('RECEIVED','SUBMITTING','UNKNOWN','SETTLED','REVIEW','RETURNED'));
