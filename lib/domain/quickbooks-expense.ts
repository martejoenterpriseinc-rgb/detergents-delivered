import { z } from "zod";
export const qboExpenseSource = z
  .object({
    categoryId: z.string(),
    amountCents: z.number().int().positive().max(100000000),
    currency: z.literal("USD"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    memo: z.string().max(1000),
  })
  .strict();
export const qboExpensePayload = z
  .object({
    DocNumber: z.string().regex(/^DD[a-f0-9]{19}$/),
    TxnDate: z.string(),
    PaymentType: z.enum(["Cash", "CreditCard"]),
    AccountRef: z.object({ value: z.string() }),
    CurrencyRef: z.object({ value: z.literal("USD") }),
    Line: z
      .array(
        z.object({
          Amount: z
            .number()
            .refine(
              (value) => qboAmountCents(value) !== null && value > 0 && value <= 1000000,
            ),
          Description: z.string(),
          DetailType: z.literal("AccountBasedExpenseLineDetail"),
          AccountBasedExpenseLineDetail: z.object({
            AccountRef: z.object({ value: z.string() }),
          }),
        }),
      )
      .length(1),
  })
  .strict();
// Decimal comparison against saved integer cents; never infer tax from totals.
export function qboAmountCents(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}
export function matchQboExpense(raw: unknown, payload: unknown) {
  const expected = qboExpensePayload.parse(payload);
  const receipt = z
    .object({
      Id: z.string().regex(/^\d{1,30}$/),
      DocNumber: z.string(),
      TxnDate: z.string(),
      PaymentType: z.string(),
      AccountRef: z.object({ value: z.string() }),
      CurrencyRef: z.object({ value: z.string() }),
      TotalAmt: z.number(),
      Credit: z.boolean().optional(),
      TxnTaxDetail: z.object({ TotalTax: z.number().optional() }).optional(),
      Line: z.array(
        z.object({
          Amount: z.number(),
          Description: z.string().optional(),
          DetailType: z.string(),
          AccountBasedExpenseLineDetail: z
            .object({ AccountRef: z.object({ value: z.string() }) })
            .optional(),
        }),
      ),
    })
    .parse(raw);
  if (
    receipt.DocNumber !== expected.DocNumber ||
    receipt.TxnDate !== expected.TxnDate ||
    receipt.PaymentType !== expected.PaymentType ||
    receipt.AccountRef.value !== expected.AccountRef.value ||
    receipt.CurrencyRef.value !== "USD" ||
    receipt.Credit === true ||
    (receipt.TxnTaxDetail?.TotalTax ?? 0) !== 0 ||
    receipt.Line.length !== 1 ||
    receipt.Line[0].Description !== expected.Line[0].Description ||
    receipt.Line[0].DetailType !== "AccountBasedExpenseLineDetail" ||
    receipt.Line[0].AccountBasedExpenseLineDetail?.AccountRef.value !==
      expected.Line[0].AccountBasedExpenseLineDetail.AccountRef.value ||
    qboAmountCents(receipt.TotalAmt) !== qboAmountCents(expected.Line[0].Amount) ||
    qboAmountCents(receipt.Line[0].Amount) !== qboAmountCents(expected.Line[0].Amount)
  )
    throw new Error("QuickBooks expense evidence does not match the prepared source.");
  return receipt.Id;
}
