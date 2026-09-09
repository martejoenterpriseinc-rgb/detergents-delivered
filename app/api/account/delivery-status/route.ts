import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { getDeliveryWidget } from "@/lib/services/delivery-widget";
export async function GET() {
  try {
    return accountJson(await getDeliveryWidget(await accountRequest()));
  } catch (e) {
    return accountFailure(e);
  }
}
