import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  getCustomerAccount,
  updateCustomerProfile,
} from "@/lib/services/customer-account";
export async function GET() {
  try {
    return accountJson(await getCustomerAccount(await accountRequest()));
  } catch (e) {
    return accountFailure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    return accountJson(
      await updateCustomerProfile(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
