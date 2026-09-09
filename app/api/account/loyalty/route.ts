import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { getLoyalty, loyaltyAction } from "@/lib/services/loyalty";
export async function GET() {
  try {
    return accountJson(await getLoyalty(await accountRequest()));
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await loyaltyAction(await accountRequest(request), await readAccountJson(request)),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
