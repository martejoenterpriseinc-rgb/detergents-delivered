import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { listOrders } from "@/lib/services/order-workspace";
export async function GET(request: Request) {
  try {
    return accountJson(
      await listOrders(
        await accountRequest(),
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
