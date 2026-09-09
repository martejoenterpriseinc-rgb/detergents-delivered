import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { quoteCartRewards } from "@/lib/services/loyalty";
export async function POST(request: Request) {
  try {
    return accountJson(
      await quoteCartRewards(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
