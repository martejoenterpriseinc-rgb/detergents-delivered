import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import { issueCommerceGrant, revokeCommerceGrant } from "@/lib/services/commerce-grants";
export async function POST(request: Request) {
  try {
    const actor = await accountRequest(request),
      raw = await readAccountJson(request);
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new AccountError("Invalid connection request.");
    const { action, ...input } = raw as Record<string, unknown>;
    if (action === "issue") return accountJson(await issueCommerceGrant(actor, input));
    if (action === "revoke") return accountJson(await revokeCommerceGrant(actor, input));
    throw new AccountError("Choose create or revoke.");
  } catch (error) {
    return accountFailure(error);
  }
}
