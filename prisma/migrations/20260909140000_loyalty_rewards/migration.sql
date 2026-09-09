BEGIN;

-- CreateEnum
CREATE TYPE "ReferralState" AS ENUM ('PENDING', 'REWARDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RewardEntryKind" AS ENUM ('REFERRAL', 'REDEMPTION', 'RESTORE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "RewardReservationState" AS ENUM ('HELD', 'USED', 'RELEASED');

-- AlterTable
ALTER TABLE "PaymentEvent" ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN     "friendCreditCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "linkId" TEXT,
ADD COLUMN     "minimumPurchaseCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "programVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "qualifyingOrderId" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ReferralState" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "referrerRewardCents" INTEGER NOT NULL DEFAULT 0,
    "friendRewardCents" INTEGER NOT NULL DEFAULT 0,
    "minimumPurchaseCents" INTEGER NOT NULL DEFAULT 0,
    "linkExpiryDays" INTEGER NOT NULL DEFAULT 30,
    "maxReferralsPerCustomer" INTEGER NOT NULL DEFAULT 25,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralLink" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "copiedAt" TIMESTAMP(3),
    "sharedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "ReferralLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL,
    "kind" "RewardEntryKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "orderId" TEXT,
    "sourceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "orderTotalCents" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "state" "RewardReservationState" NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLink_token_key" ON "ReferralLink"("token");

-- CreateIndex
CREATE INDEX "ReferralLink_customerId_createdAt_idx" ON "ReferralLink"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLink_customerId_requestKey_key" ON "ReferralLink"("customerId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "RewardEntry_entryKey_key" ON "RewardEntry"("entryKey");

-- CreateIndex
CREATE INDEX "RewardEntry_customerId_createdAt_idx" ON "RewardEntry"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "RewardEntry_sourceId_idx" ON "RewardEntry"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardReservation_orderId_key" ON "RewardReservation"("orderId");

-- CreateIndex
CREATE INDEX "RewardReservation_customerId_state_idx" ON "RewardReservation"("customerId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "RewardReservation_customerId_requestKey_key" ON "RewardReservation"("customerId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_linkId_key" ON "Referral"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_qualifyingOrderId_key" ON "Referral"("qualifyingOrderId");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ReferralLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_qualifyingOrderId_fkey" FOREIGN KEY ("qualifyingOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralLink" ADD CONSTRAINT "ReferralLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEntry" ADD CONSTRAINT "RewardEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEntry" ADD CONSTRAINT "RewardEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardReservation" ADD CONSTRAINT "RewardReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardReservation" ADD CONSTRAINT "RewardReservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve financial history and reject invalid minor-unit values at the database boundary.
ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_rules_check" CHECK (
  "referrerRewardCents" BETWEEN 0 AND 100000 AND "friendRewardCents" BETWEEN 0 AND 100000
  AND "minimumPurchaseCents" BETWEEN 0 AND 1000000 AND "linkExpiryDays" BETWEEN 1 AND 365
  AND "maxReferralsPerCustomer" BETWEEN 1 AND 500 AND "version" >= 0
);
ALTER TABLE "RewardReservation" ADD CONSTRAINT "RewardReservation_amount_check" CHECK (
  "amountCents" > 0 AND "orderTotalCents" >= "amountCents"
);
ALTER TABLE "RewardEntry" ADD CONSTRAINT "RewardEntry_sign_check" CHECK (
  ("kind" IN ('REFERRAL', 'RESTORE') AND "amountCents" > 0)
  OR ("kind" IN ('REDEMPTION', 'REVERSAL') AND "amountCents" < 0)
);
CREATE FUNCTION dd_preserve_reward_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Reward entries are append-only; use a compensating entry';
END;
$$;
CREATE TRIGGER dd_reward_entry_immutable BEFORE UPDATE OR DELETE ON "RewardEntry"
FOR EACH ROW EXECUTE FUNCTION dd_preserve_reward_entry();

COMMIT;
