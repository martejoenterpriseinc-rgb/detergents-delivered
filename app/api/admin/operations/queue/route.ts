import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { dailyQueue } from "@/lib/services/operations";
import { deliveryAction } from "@/lib/services/delivery-operations";
export async function GET(r: Request) {
  try {
    return accountJson(
      await dailyQueue(
        await accountRequest(),
        new URL(r.url).searchParams.get("date") ?? undefined,
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(r: Request) {
  try {
    return accountJson(
      await deliveryAction(await accountRequest(r), await readAccountJson(r)),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
