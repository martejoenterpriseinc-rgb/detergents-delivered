import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import {
  reviewSalesRefundSource,
  salesRefundChoices,
} from "@/lib/services/sales-refund-source";
export async function GET(request: Request) {
  try {
    const actor = await accountRequest(),
      q = new URL(request.url).searchParams;
    return accountJson(
      q.has("orderId")
        ? await reviewSalesRefundSource(actor, {
            orderId: q.get("orderId"),
            ...(q.has("adjustmentId") ? { adjustmentId: q.get("adjustmentId") } : {}),
          })
        : await salesRefundChoices(actor, q.get("cursor") ?? undefined),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
