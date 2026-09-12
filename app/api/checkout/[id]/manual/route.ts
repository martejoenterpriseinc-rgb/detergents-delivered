import {
  accountRequest,
  readAccountJson,
  accountJson,
  accountFailure,
} from "@/lib/account-api";
import {
  beginManualCheckout,
  manualCheckoutChoices,
} from "@/lib/services/manual-checkout";
import { z } from "zod";
export async function GET(_r: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return accountJson({
      methods: await manualCheckoutChoices(
        await accountRequest(),
        (await context.params).id,
      ),
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
    const actor = await accountRequest(request);
    const d = z
      .object({ method: z.enum(["CASH", "ZELLE"]), acceptedWindow: z.literal(true) })
      .strict()
      .parse(await readAccountJson(request));
    return accountJson(
      await beginManualCheckout(actor, { ...d, checkoutId: (await context.params).id }),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
