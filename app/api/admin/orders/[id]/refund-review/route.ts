import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import { refundReviewInput, reviewPaymentRefunds } from "@/lib/services/refund-review";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await accountRequest(request);
    const input = refundReviewInput.parse(await readAccountJson(request));
    if (input.orderId !== (await context.params).id)
      throw new AccountError("The request does not match this order.", 409);
    return accountJson(await reviewPaymentRefunds(actor, input));
  } catch (error) {
    return accountFailure(error);
  }
}
