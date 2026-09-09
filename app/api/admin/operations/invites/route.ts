import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { createCustomerInvite } from "@/lib/services/operations";
export async function POST(r: Request) {
  try {
    const result = await createCustomerInvite(
      await accountRequest(r),
      await readAccountJson(r),
    );
    return accountJson({
      ...result,
      url: new URL(`/invite/${result.token}`, process.env.AUTH_URL).href,
      emailSent: false,
    });
  } catch (e) {
    return accountFailure(e);
  }
}
