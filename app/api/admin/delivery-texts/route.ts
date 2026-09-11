import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { deliveryTextStatus } from "@/lib/services/sms-delivery";
export async function GET(request: Request) {
  try {
    return accountJson(await deliveryTextStatus(await accountRequest(request)));
  } catch (e) {
    return accountFailure(e);
  }
}
