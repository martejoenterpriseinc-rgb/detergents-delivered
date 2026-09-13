import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  matchTipRefundTax,
  matchTipRefundTaxCorrection,
} from "@/lib/services/tip-refund-tax";
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

export async function PUT(request: Request) {
  try {
    return accountJson(
      await matchTipRefundTaxCorrection(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
