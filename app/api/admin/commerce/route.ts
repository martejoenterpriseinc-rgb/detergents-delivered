import { z } from "zod";
import {
  accountRequest,
  readAccountJson,
  accountJson,
  accountFailure,
} from "@/lib/account-api";
import { loyaltyAdmin } from "@/lib/services/loyalty";
import { prisma } from "@/lib/prisma";
import { approveDeliveryAddress } from "@/lib/commerce/onboarding";
import { reconcileCheckout } from "@/lib/commerce/checkout";
export async function POST(request: Request) {
  try {
    const userId = await accountRequest(request);
    await loyaltyAdmin(prisma, userId);
    const input = await readAccountJson(request);
    const envelope = z
      .object({ action: z.enum(["approveAddress", "reconcile"]), data: z.unknown() })
      .strict()
      .parse(input);
    if (envelope.action === "approveAddress")
      return accountJson(await approveDeliveryAddress(userId, envelope.data));
    const data = z
      .object({ id: z.string().min(1).max(100) })
      .strict()
      .parse(envelope.data);
    await reconcileCheckout(data.id);
    return accountJson({ status: "RECONCILED" });
  } catch (e) {
    return accountFailure(e);
  }
}
