import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { matchRefundTaxCorrection } from "@/lib/services/refund-tax-corrections";
export async function POST(request: Request) {
  try {
    const actor = await accountRequest(request);
    return accountJson(
      await matchRefundTaxCorrection(actor, await readAccountJson(request)),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
