import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  createSubscription,
  changeSubscription,
  readSubscriptions,
} from "@/lib/services/subscriptions";
import {
  subscriptionCreateInput,
  subscriptionChangeInput,
} from "@/lib/domain/subscriptions";
const input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), data: subscriptionCreateInput }).strict(),
  z.object({ kind: z.literal("change"), data: subscriptionChangeInput }).strict(),
]);
export async function GET() {
  try {
    return accountJson(await readSubscriptions(await accountRequest()));
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await accountRequest(request),
      value = input.parse(await readAccountJson(request));
    return accountJson(
      value.kind === "create"
        ? await createSubscription(actor, value.data)
        : await changeSubscription(actor, value.data),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
