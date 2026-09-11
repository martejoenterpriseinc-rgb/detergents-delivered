import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { matchRefundTaxEvidence } from "@/lib/services/refund-tax-evidence";
export async function POST(request: Request) {
  try {
    const actor = await accountRequest(request);
    return accountJson(
      await matchRefundTaxEvidence(actor, await readAccountJson(request)),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
