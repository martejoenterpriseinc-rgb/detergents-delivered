import { z } from "zod";
import { costPiece, recordedCost } from "./quickbooks-cost";
import { qboAmountCents } from "./quickbooks-expense";
export const journalSource = z
  .object({
    kind: z.enum(["SALE", "RETURN"]),
    orderId: z.string(),
    number: z.string(),
    sourceId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.literal("USD"),
    amountCents: z.number().int().positive().max(100000000),
    pieces: z.array(costPiece).min(1).max(500),
  })
  .strict()
  .refine((s) => recordedCost(s.pieces) === s.amountCents);
const detail = z.object({
  PostingType: z.enum(["Debit", "Credit"]),
  AccountRef: z.object({ value: z.string().regex(/^\d{1,30}$/) }),
});
export const journalPayload = z
  .object({
    DocNumber: z.string().regex(/^DC[a-f0-9]{19}$/),
    TxnDate: z.string(),
    CurrencyRef: z.object({ value: z.literal("USD") }),
    Line: z
      .array(
        z.object({
          Amount: z
            .number()
            .refine((v) => v > 0 && v <= 1000000 && qboAmountCents(v) !== null),
          Description: z.string(),
          DetailType: z.literal("JournalEntryLineDetail"),
          JournalEntryLineDetail: detail,
        }),
      )
      .length(2),
  })
  .strict()
  .refine(
    (p) =>
      p.Line[0].JournalEntryLineDetail.PostingType === "Debit" &&
      p.Line[1].JournalEntryLineDetail.PostingType === "Credit" &&
      p.Line[0].JournalEntryLineDetail.AccountRef.value !==
        p.Line[1].JournalEntryLineDetail.AccountRef.value &&
      qboAmountCents(p.Line[0].Amount) === qboAmountCents(p.Line[1].Amount),
  );
export function matchCostJournal(raw: unknown, payload: unknown) {
  const expected = journalPayload.parse(payload);
  const receipt = z
    .object({
      Id: z.string().regex(/^\d{1,30}$/),
      DocNumber: z.string(),
      TxnDate: z.string(),
      CurrencyRef: z.object({ value: z.string() }),
      Adjustment: z.boolean().optional(),
      HomeCurrencyAdjustment: z.boolean().optional(),
      TxnTaxDetail: z.object({ TotalTax: z.number().optional() }).optional(),
      Line: z
        .array(
          z.object({
            Amount: z.number(),
            Description: z.string().optional(),
            DetailType: z.string(),
            JournalEntryLineDetail: detail.extend({
              TaxAmount: z.number().optional(),
              TaxCodeRef: z.unknown().optional(),
            }),
          }),
        )
        .length(2),
    })
    .parse(raw);
  if (
    receipt.DocNumber !== expected.DocNumber ||
    receipt.TxnDate !== expected.TxnDate ||
    receipt.CurrencyRef.value !== "USD" ||
    receipt.Adjustment === true ||
    receipt.HomeCurrencyAdjustment === true ||
    (receipt.TxnTaxDetail?.TotalTax ?? 0) !== 0
  )
    throw new Error("Journal evidence differs from the prepared cost.");
  for (const line of expected.Line) {
    const matches = receipt.Line.filter(
      (r) =>
        r.JournalEntryLineDetail.PostingType === line.JournalEntryLineDetail.PostingType,
    );
    const r = matches[0];
    if (
      matches.length !== 1 ||
      r.DetailType !== "JournalEntryLineDetail" ||
      r.Description !== line.Description ||
      r.JournalEntryLineDetail.AccountRef.value !==
        line.JournalEntryLineDetail.AccountRef.value ||
      qboAmountCents(r.Amount) !== qboAmountCents(line.Amount) ||
      (r.JournalEntryLineDetail.TaxAmount ?? 0) !== 0 ||
      r.JournalEntryLineDetail.TaxCodeRef !== undefined
    )
      throw new Error("Journal lines differ from the prepared cost.");
  }
  return receipt.Id;
}
