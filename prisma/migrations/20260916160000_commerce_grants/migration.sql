CREATE TABLE "CommerceGrant" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "customerId" TEXT NOT NULL,
 "tokenHash" TEXT NOT NULL UNIQUE CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
 "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
 "sessionVersion" INTEGER NOT NULL,
 "environment" TEXT NOT NULL CHECK ("environment" IN ('sandbox','live')),
 "label" TEXT NOT NULL, "scopes" TEXT[] NOT NULL,
 "consentVersion" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3),
 "windowStartedAt" TIMESTAMP(3), "requestCount" INTEGER NOT NULL DEFAULT 0 CHECK ("requestCount" >= 0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommerceGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CommerceGrant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CommerceGrant_customerId_createdAt_idx" ON "CommerceGrant"("customerId", "createdAt");
CREATE FUNCTION dd_preserve_commerce_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Commerce consent history cannot be deleted'; END IF;
 IF (NEW."id", NEW."userId", NEW."customerId", NEW."tokenHash", NEW."requestHash", NEW."sessionVersion", NEW."environment", NEW."label", NEW."scopes", NEW."consentVersion", NEW."expiresAt", NEW."createdAt") IS DISTINCT FROM
    (OLD."id", OLD."userId", OLD."customerId", OLD."tokenHash", OLD."requestHash", OLD."sessionVersion", OLD."environment", OLD."label", OLD."scopes", OLD."consentVersion", OLD."expiresAt", OLD."createdAt") OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN RAISE EXCEPTION 'Commerce consent is immutable; revoke and create a new connection'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "CommerceGrant_preserve" BEFORE UPDATE OR DELETE ON "CommerceGrant" FOR EACH ROW EXECUTE FUNCTION dd_preserve_commerce_grant();
