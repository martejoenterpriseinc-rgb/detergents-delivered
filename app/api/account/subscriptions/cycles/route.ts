import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { prepareSubscriptionCycle } from "@/lib/services/subscription-cycles";
import { subscriptionCycleInput } from "@/lib/domain/subscriptions";
export async function POST(request: Request) {
  try {
    const actor = await accountRequest(request);
    return accountJson(
      await prepareSubscriptionCycle(
        actor,
        subscriptionCycleInput.parse(await readAccountJson(request)),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
