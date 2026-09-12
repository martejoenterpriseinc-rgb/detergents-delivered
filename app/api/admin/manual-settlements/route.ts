import { z } from "zod";
import {
  accountRequest,
  readAccountJson,
  accountJson,
  accountFailure,
} from "@/lib/account-api";
import {
  recordManualReceipt,
  reconcileManualCheckout,
  readManualCheckouts,
} from "@/lib/services/manual-checkout";
export async function GET() {
  try {
    return accountJson(await readManualCheckouts(await accountRequest()));
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await recordManualReceipt(
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
    const actor = await accountRequest(request);
    const d = z
      .object({
        id: z.string().min(1).max(100),
        taxTransactionId: z
          .string()
          .regex(/^tax_[A-Za-z0-9]+$/)
          .optional(),
      })
      .strict()
      .parse(await readAccountJson(request));
    return accountJson(await reconcileManualCheckout(actor, d.id, d.taxTransactionId));
  } catch (e) {
    return accountFailure(e);
  }
}
