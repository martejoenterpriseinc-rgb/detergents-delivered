import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  readManualPaymentApprovals,
  saveManualPaymentApproval,
} from "@/lib/services/manual-payment-approvals";
export async function GET(r: Request) {
  try {
    return accountJson(
      await readManualPaymentApprovals(
        await accountRequest(),
        new URL(r.url).searchParams.get("customerId") ?? "",
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(r: Request) {
  try {
    return accountJson(
      await saveManualPaymentApproval(await accountRequest(r), await readAccountJson(r)),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
