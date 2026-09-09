import {
  accountRequest,
  readAccountJson,
  accountJson,
  accountFailure,
} from "@/lib/account-api";
import { saveDeliveryAddress } from "@/lib/commerce/onboarding";
export async function POST(request: Request) {
  try {
    return accountJson(
      await saveDeliveryAddress(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
