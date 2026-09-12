import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  beginDeliveryTip,
  reconcileOwnedDeliveryTip,
} from "@/lib/services/delivery-tips";
export async function POST(r: Request) {
  try {
    return accountJson(
      await beginDeliveryTip(await accountRequest(r), await readAccountJson(r)),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function PATCH(r: Request) {
  try {
    const actor = await accountRequest(r),
      d = z
        .object({ id: z.string().min(1).max(100) })
        .strict()
        .parse(await readAccountJson(r));
    return accountJson(await reconcileOwnedDeliveryTip(actor, d.id));
  } catch (e) {
    return accountFailure(e);
  }
}
