import { z } from "zod";
import {
  accountRequest,
  readAccountJson,
  accountJson,
  accountFailure,
} from "@/lib/account-api";
import {
  prepareManualRefund,
  recordManualRefund,
  readManualRefunds,
} from "@/lib/services/manual-refunds";
import { cancelPreparedRefund } from "@/lib/services/refunds";
import { financeAccess } from "@/lib/services/finance";
import { prisma } from "@/lib/prisma";
export async function GET(request: Request) {
  try {
    return accountJson(
      await readManualRefunds(
        await accountRequest(),
        new URL(request.url).searchParams.get("orderId") ?? "",
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await prepareManualRefund(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    return accountJson(
      await recordManualRefund(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    const actor = await accountRequest(request);
    await financeAccess(prisma, actor, true);
    const d = z
      .object({
        orderId: z.string().min(1).max(100),
        requestId: z.string().min(1).max(100),
        reason: z.string().trim().min(10).max(500),
      })
      .strict()
      .parse(await readAccountJson(request));
    // Revalidates the manual order and environment before using the shared draft cancellation.
    await readManualRefunds(actor, d.orderId);
    return accountJson(await cancelPreparedRefund(actor, d));
  } catch (e) {
    return accountFailure(e);
  }
}
