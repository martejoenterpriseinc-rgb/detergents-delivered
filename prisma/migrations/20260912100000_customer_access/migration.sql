CREATE TABLE "PasswordRecovery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCiphertext" BYTEA,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseId" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordRecovery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PasswordRecovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordRecovery_tokenHash_key" ON "PasswordRecovery"("tokenHash");
CREATE INDEX "PasswordRecovery_userId_consumedAt_idx" ON "PasswordRecovery"("userId", "consumedAt");
CREATE INDEX "PasswordRecovery_nextAttemptAt_deliveredAt_idx" ON "PasswordRecovery"("nextAttemptAt", "deliveredAt");
CREATE INDEX "PasswordRecovery_expiresAt_idx" ON "PasswordRecovery"("expiresAt");

CREATE TABLE "AuthenticationThrottle" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthenticationThrottle_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "AuthenticationThrottle_expiresAt_idx" ON "AuthenticationThrottle"("expiresAt");
