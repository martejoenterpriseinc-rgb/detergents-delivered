import { ENVIRONMENT_KEY, validateDatabaseEnvironment } from "@/lib/database-environment";
import { prisma } from "@/lib/prisma";
import { validateRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    validateRuntimeConfig(process.env);
    // No customer data is read. These probes verify the columns needed at startup.
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '3000ms'`;
        await tx.$queryRaw`SELECT "mustChangeCredentials", "sessionVersion", "passwordChangeFailures", "passwordChangeLockedUntil" FROM "User" LIMIT 0`;
        await tx.$queryRaw`SELECT "purchaseApprovedAt", "emailNotifications", "smsNotifications" FROM "Customer" LIMIT 0`;
        await tx.$queryRaw`SELECT "status", "version", "requestHash" FROM "SupportTicket" LIMIT 0`;
        await tx.$queryRaw`SELECT "body", "requestKey" FROM "SupportMessage" LIMIT 0`;
        await tx.$queryRaw`SELECT "version" FROM "LoyaltyProgram" LIMIT 0`;
        await tx.$queryRaw`SELECT "entryKey", "amountCents" FROM "RewardEntry" LIMIT 0`;
        await tx.$queryRaw`SELECT "state", "orderTotalCents" FROM "RewardReservation" LIMIT 0`;
        await tx.$queryRaw`SELECT "token", "expiresAt" FROM "ReferralLink" LIMIT 0`;
        await tx.$queryRaw`SELECT "verifiedAt" FROM "PaymentEvent" LIMIT 0`;
        await tx.$queryRaw`SELECT "status", "friendCreditCents" FROM "Referral" LIMIT 0`;
        await tx.$queryRaw`SELECT "code" FROM "Role" LIMIT 0`;
        await tx.$queryRaw`SELECT "websiteVisible" FROM "ProductVariant" LIMIT 0`;
        await tx.$queryRaw`SELECT "visible" FROM "SiteSection" LIMIT 0`;
        await tx.$queryRaw`SELECT "valueJson" FROM "Setting" LIMIT 0`;
        await tx.$queryRaw`SELECT "validatedAt", "validationSource" FROM "Address" LIMIT 0`;
        await tx.$queryRaw`SELECT "loadKind" FROM "Product" LIMIT 0`;
        await tx.$queryRaw`SELECT "capacityUnits", "detergentBucketLimit", "scentBeadBucketLimit" FROM "Vehicle" LIMIT 0`;
        await tx.$queryRaw`SELECT "version", "startsOn", "endsOn" FROM "Promotion" LIMIT 0`;
        await tx.$queryRaw`SELECT "recoveryCheckedAt" FROM "CheckoutAttempt" LIMIT 0`;
        await tx.$queryRaw`SELECT "kind", "environment", "bytes", "keyId", "byteSize", "sha256" FROM "OperationalMedia" LIMIT 0`;
        await tx.$queryRaw`SELECT "environment", "state", "leaseId", "leasedUntil", "heartbeatAt", "nextRunAt" FROM "OperationalJob" LIMIT 0`;
        if (process.env.APP_ENV === "production") {
          const marker = await tx.setting.findUnique({ where: { key: ENVIRONMENT_KEY } });
          validateDatabaseEnvironment(
            marker?.valueJson,
            process.env.APP_ENV,
            decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1)),
          );
        }
      },
      { timeout: 5000, maxWait: 2000 },
    );
    return Response.json(
      { ok: true, service: "detergents-delivered" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, service: "detergents-delivered" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
