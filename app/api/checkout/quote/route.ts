import {
  accountRequest,
  readAccountJson,
  accountJson,
  accountFailure,
} from "@/lib/account-api";
import { createQuote } from "@/lib/commerce/quote";
export async function POST(request: Request) {
  try {
    return accountJson(
      await createQuote(await accountRequest(request), await readAccountJson(request)),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
