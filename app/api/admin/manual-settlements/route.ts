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
  resolveManualSettlement,
} from "@/lib/services/manual-checkout";
export async function PUT(request: Request) {
  try {
    return accountJson(
      await resolveManualSettlement(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
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
        retryReviewed: z.boolean().optional(),
        taxTransactionId: z
          .string()
          .regex(/^tax_[A-Za-z0-9]+$/)
          .optional(),
      })
      .strict()
      .parse(await readAccountJson(request));
    return accountJson(
      await reconcileManualCheckout(actor, d.id, d.taxTransactionId, d.retryReviewed),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
