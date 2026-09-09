import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { updateNotifications } from "@/lib/services/customer-account";
export async function PATCH(request: Request) {
  try {
    return accountJson(
      await updateNotifications(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
