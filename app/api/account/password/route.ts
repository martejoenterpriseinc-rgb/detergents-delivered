import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { changeAccountPassword } from "@/lib/services/customer-account";
export async function POST(request: Request) {
  try {
    return accountJson(
      await changeAccountPassword(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
