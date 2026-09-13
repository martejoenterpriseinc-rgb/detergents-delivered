import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  submitTipRefund,
  reconcileTipRefund,
  retryUncertainTipRefund,
} from "@/lib/services/tip-refunds";
export async function POST(request: Request) {
  try {
    return accountJson(
      await submitTipRefund(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const actor = await accountRequest(request),
      input = z
        .object({ id: z.string().min(1).max(100) })
        .strict()
        .parse(await readAccountJson(request));
    return accountJson(await reconcileTipRefund(actor, input.id));
  } catch (error) {
    return accountFailure(error);
  }
}

export async function PUT(request: Request) {
  try {
    return accountJson(
      await retryUncertainTipRefund(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
