import { requireApiRole } from "@/lib/api-auth";
import { accountJson } from "@/lib/account-api";
import { integrationStatus } from "@/lib/services/integration-status";
export const dynamic = "force-dynamic";
export async function GET() {
  const gate = await requireApiRole(["ADMIN", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  return accountJson(integrationStatus());
}
