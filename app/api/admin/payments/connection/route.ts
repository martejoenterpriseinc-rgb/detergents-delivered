import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { financeAccess } from "@/lib/services/finance";
import { prisma } from "@/lib/prisma";
import { paymentConnection } from "@/lib/commerce/payment-connection";
export async function GET() {
  try {
    await financeAccess(prisma, await accountRequest(), true);
    return accountJson(await paymentConnection());
  } catch (e) {
    return accountFailure(e);
  }
}
