-- Additive storage and scheduler records. Existing catalog and financial rows are unchanged.
CREATE TABLE "OperationalMedia" (
  "key" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "keyId" TEXT,
  "sha256" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalMedia_kind_check" CHECK ("kind" IN ('CATALOG', 'PROOF')),
  CONSTRAINT "OperationalMedia_environment_check" CHECK ("environment" IN ('sandbox', 'live')),
  CONSTRAINT "OperationalMedia_size_check" CHECK ("byteSize" > 0 AND "byteSize" <= 4194304),
  CONSTRAINT "OperationalMedia_encryption_check" CHECK (("kind" = 'PROOF' AND "keyId" IS NOT NULL) OR ("kind" = 'CATALOG' AND "keyId" IS NULL))
);
CREATE INDEX "OperationalMedia_environment_kind_createdAt_idx" ON "OperationalMedia"("environment", "kind", "createdAt");

CREATE TABLE "OperationalJob" (
  "id" TEXT PRIMARY KEY,
  "environment" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'WAITING',
  "leaseId" TEXT,
  "leasedUntil" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "checked" INTEGER NOT NULL DEFAULT 0,
  "completed" INTEGER NOT NULL DEFAULT 0,
  "attention" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalJob_environment_check" CHECK ("environment" IN ('sandbox', 'live')),
  CONSTRAINT "OperationalJob_state_check" CHECK ("state" IN ('WAITING', 'RUNNING', 'HEALTHY', 'BLOCKED', 'ATTENTION', 'FAILED')),
  CONSTRAINT "OperationalJob_counters_check" CHECK ("consecutiveFailures" >= 0 AND "checked" >= 0 AND "completed" >= 0 AND "attention" >= 0)
);
CREATE INDEX "OperationalJob_environment_nextRunAt_idx" ON "OperationalJob"("environment", "nextRunAt");

-- Scheduler fairness metadata; no historical prices, balances or payment evidence changes.
ALTER TABLE "CheckoutAttempt" ADD COLUMN "recoveryCheckedAt" TIMESTAMP(3);
