import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { recordTipPayout } from "@/lib/services/tip-payouts";
export async function POST(request: Request) {
  try {
    return accountJson(
      await recordTipPayout(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
