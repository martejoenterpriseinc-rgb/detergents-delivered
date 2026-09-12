import { z } from "zod";
import {
  accountRequest,
  readAccountJson,
  accountJson,
  accountFailure,
} from "@/lib/account-api";
import {
  beginCheckout,
  cancelCheckout,
  ownedCheckout,
  reconcileCheckout,
} from "@/lib/commerce/checkout";
import { publicCheckout } from "@/lib/commerce/quote";
import { rewardBalance } from "@/lib/services/loyalty";
import { prisma } from "@/lib/prisma";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const a = await ownedCheckout(await accountRequest(), (await context.params).id);
    const wallet = await rewardBalance(prisma, a.customerId);
    return accountJson({
      ...publicCheckout(a),
      remainingRewardsCents: wallet.availableCents,
    });
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await accountRequest(request);
    const id = (await context.params).id;
    const input = z
      .object({
        action: z.enum(["pay", "cancel", "refresh"]),
        acceptedWindow: z.boolean().optional(),
      })
      .strict()
      .parse(await readAccountJson(request));
    await ownedCheckout(userId, id);
    if (input.action === "pay")
      return accountJson(await beginCheckout(userId, id, input.acceptedWindow === true));
    if (input.action === "cancel") await cancelCheckout(userId, id);
    else if ((await ownedCheckout(userId, id)).paymentMethod === "STRIPE")
      await reconcileCheckout(id);
    return accountJson(publicCheckout(await ownedCheckout(userId, id)));
  } catch (e) {
    return accountFailure(e);
  }
}
