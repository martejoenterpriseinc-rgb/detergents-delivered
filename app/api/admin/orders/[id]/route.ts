import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { getOrder } from "@/lib/services/order-workspace";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return accountJson(await getOrder(await accountRequest(), (await context.params).id));
  } catch (error) {
    return accountFailure(error);
  }
}
