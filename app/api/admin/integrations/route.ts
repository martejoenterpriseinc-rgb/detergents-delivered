import { requireApiRole } from "@/lib/api-auth";
import { accountJson } from "@/lib/account-api";
import { getIntegrationStatus } from "@/lib/integrations/status";
export const dynamic = "force-dynamic";
export async function GET() {
  const gate = await requireApiRole(["ADMIN", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  return accountJson(await getIntegrationStatus());
}
