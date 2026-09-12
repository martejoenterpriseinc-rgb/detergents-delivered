import {
  accountRequest,
  readAccountJson,
  accountJson,
  accountFailure,
} from "@/lib/account-api";
import { reconcileManualRefundTax } from "@/lib/services/manual-refund-tax";
export async function POST(request: Request) {
  try {
    return accountJson(
      await reconcileManualRefundTax(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
