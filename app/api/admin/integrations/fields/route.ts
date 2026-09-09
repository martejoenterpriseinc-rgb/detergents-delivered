import { requireApiRole } from "@/lib/api-auth";
import {
  accountFailure,
  accountJson,
  accountRequest,
  readAccountJson,
} from "@/lib/account-api";
import { apiEditorData, saveApiField } from "@/lib/integrations/vault";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const gate = await requireApiRole(["ADMIN", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  try {
    return accountJson(await apiEditorData());
  } catch (error) {
    return accountFailure(error);
  }
}
export async function PATCH(request: Request) {
  const gate = await requireApiRole(["ADMIN", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  try {
    await accountRequest(request); // Exact-origin JSON request; no GET mutations.
    return accountJson(
      await saveApiField(gate.session.user.id, await readAccountJson(request)),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
