import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { updateProgram } from "@/lib/services/loyalty";
import { reviewReferral } from "@/lib/services/reward-ledger";
export async function PATCH(request: Request) {
  try {
    return accountJson(
      await updateProgram(await accountRequest(request), await readAccountJson(request)),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const userId = await accountRequest(request);
    const data = z
      .object({ referralId: z.string().min(1).max(100) })
      .strict()
      .parse(await readAccountJson(request));
    return accountJson(await reviewReferral(userId, data.referralId));
  } catch (e) {
    return accountFailure(e);
  }
}
