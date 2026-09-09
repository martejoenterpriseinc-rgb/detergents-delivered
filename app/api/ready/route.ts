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
        await tx.$queryRaw`SELECT "emailNotifications", "smsNotifications" FROM "Customer" LIMIT 0`;
        await tx.$queryRaw`SELECT "status", "version", "requestHash" FROM "SupportTicket" LIMIT 0`;
        await tx.$queryRaw`SELECT "body", "requestKey" FROM "SupportMessage" LIMIT 0`;
        await tx.$queryRaw`SELECT "code" FROM "Role" LIMIT 0`;
        await tx.$queryRaw`SELECT "websiteVisible" FROM "ProductVariant" LIMIT 0`;
        await tx.$queryRaw`SELECT "visible" FROM "SiteSection" LIMIT 0`;
        await tx.$queryRaw`SELECT "valueJson" FROM "Setting" LIMIT 0`;
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
