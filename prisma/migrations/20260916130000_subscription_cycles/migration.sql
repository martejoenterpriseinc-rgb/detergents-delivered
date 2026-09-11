CREATE TABLE "SubscriptionCycle" (
  "id" TEXT PRIMARY KEY,
  "subscriptionId" TEXT NOT NULL REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cycleNumber" INTEGER NOT NULL CHECK ("cycleNumber" > 0),
  "scheduledFor" DATE NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'READY' CHECK ("state" IN ('READY','PAID','SKIPPED','CANCELED')),
  "snapshot" JSONB NOT NULL,
  "paidCheckoutId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK (("state" = 'PAID') = ("paidCheckoutId" IS NOT NULL))
);
CREATE UNIQUE INDEX "SubscriptionCycle_subscriptionId_cycleNumber_key" ON "SubscriptionCycle"("subscriptionId", "cycleNumber");
CREATE UNIQUE INDEX "SubscriptionCycle_paidCheckoutId_key" ON "SubscriptionCycle"("paidCheckoutId");
CREATE INDEX "SubscriptionCycle_state_scheduledFor_idx" ON "SubscriptionCycle"("state", "scheduledFor");
ALTER TABLE "CheckoutAttempt" ADD COLUMN "subscriptionCycleId" TEXT REFERENCES "SubscriptionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CheckoutAttempt_subscriptionCycleId_idx" ON "CheckoutAttempt"("subscriptionCycleId");
ALTER TABLE "SubscriptionCycle" ADD CONSTRAINT "SubscriptionCycle_paidCheckoutId_fkey" FOREIGN KEY ("paidCheckoutId") REFERENCES "CheckoutAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION dd_preserve_subscription_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Subscription cycle evidence cannot be deleted'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."subscriptionId" IS DISTINCT FROM OLD."subscriptionId"
    OR NEW."cycleNumber" IS DISTINCT FROM OLD."cycleNumber"
    OR NEW."scheduledFor" IS DISTINCT FROM OLD."scheduledFor"
    OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot"
    OR (OLD.state <> 'READY' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW."paidCheckoutId" IS DISTINCT FROM OLD."paidCheckoutId"))
  THEN RAISE EXCEPTION 'Subscription cycle evidence is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER preserve_subscription_cycle BEFORE UPDATE OR DELETE ON "SubscriptionCycle"
  FOR EACH ROW EXECUTE FUNCTION dd_preserve_subscription_cycle();
