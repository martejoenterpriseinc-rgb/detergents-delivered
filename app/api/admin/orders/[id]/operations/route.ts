import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import {
  stockReturnInput,
  cancelRefundInput,
  refundRequestInput,
} from "@/lib/domain/refund-allocation";
import {
  recordStockReturn,
  cancelPreparedRefund,
  prepareRewardOnlyRefund,
  settleRewardOnlyRefund,
  prepareRefund,
  submitCashRefundOperation,
  reconcileCashRefundOperation,
} from "@/lib/services/refunds";

const cashReference = z
  .object({ orderId: z.string().min(1).max(100), requestId: z.string().min(1).max(100) })
  .strict();
const operation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepareCashRefund"), data: refundRequestInput }).strict(),
  z
    .object({
      action: z.literal("submitCashRefund"),
      confirmed: z.literal(true),
      data: cashReference,
    })
    .strict(),
  z
    .object({
      action: z.literal("reconcileCashRefund"),
      confirmed: z.literal(true),
      data: cashReference,
    })
    .strict(),
  z
    .object({ action: z.literal("prepareRewardRefund"), data: refundRequestInput })
    .strict(),
  z
    .object({
      action: z.literal("restoreRewardRefund"),
      confirmed: z.literal(true),
      data: z
        .object({
          orderId: z.string().min(1).max(100),
          requestId: z.string().min(1).max(100),
        })
        .strict(),
    })
    .strict(),
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
      input.action === "prepareCashRefund"
        ? await prepareRefund(actor, input.data)
        : input.action === "submitCashRefund"
          ? await submitCashRefundOperation(actor, input.data)
          : input.action === "reconcileCashRefund"
            ? await reconcileCashRefundOperation(actor, input.data)
            : input.action === "prepareRewardRefund"
              ? await prepareRewardOnlyRefund(actor, input.data)
              : input.action === "restoreRewardRefund"
                ? await settleRewardOnlyRefund(actor, input.data)
                : input.action === "receiveReturn"
                  ? await recordStockReturn(actor, input.data)
                  : await cancelPreparedRefund(actor, input.data),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
