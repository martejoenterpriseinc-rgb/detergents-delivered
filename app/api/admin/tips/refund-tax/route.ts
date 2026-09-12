import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { matchTipRefundTax } from "@/lib/services/tip-refund-tax";
export async function POST(request: Request) {
  try {
    return accountJson(
      await matchTipRefundTax(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
