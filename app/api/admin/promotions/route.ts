import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { savePromotion } from "@/lib/services/promotions";
export async function POST(request: Request) {
  try {
    return accountJson(
      await savePromotion(await accountRequest(request), await readAccountJson(request)),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
