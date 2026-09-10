import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import { stockReturnInput, cancelRefundInput } from "@/lib/domain/refund-allocation";
import { recordStockReturn, cancelPreparedRefund } from "@/lib/services/refunds";

const operation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("receiveReturn"),
      confirmed: z.literal(true),
      data: stockReturnInput,
    })
    .strict(),
  z.object({ action: z.literal("cancelRefundDraft"), data: cancelRefundInput }).strict(),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await accountRequest(request);
    const input = operation.parse(await readAccountJson(request));
    if (input.data.orderId !== (await context.params).id)
      throw new AccountError("The request does not match this order.", 409);
    return accountJson(
      input.action === "receiveReturn"
        ? await recordStockReturn(actor, input.data)
        : await cancelPreparedRefund(actor, input.data),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
