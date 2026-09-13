import { z } from "zod";
import { qboAmountCents } from "./quickbooks-expense";
export const tipAccountKeys = [
  "collectionBank",
  "payoutBank",
  "tipLiability",
  "taxLiability",
  "driverReceivable",
] as const;
export const tipJournalMapping = z
  .object({
    collectionBank: z.string().regex(/^\d{1,30}$/),
    payoutBank: z.string().regex(/^\d{1,30}$/),
    tipLiability: z.string().regex(/^\d{1,30}$/),
    taxLiability: z.string().regex(/^\d{1,30}$/),
    driverReceivable: z.string().regex(/^\d{1,30}$/),
  })
  .strict()
  .refine((v) => new Set(Object.values(v)).size === 5, "Choose five distinct accounts.");
export const tipBalances = z
  .object({
    collectionBank: z.number().int(),
    payoutBank: z.number().int(),
    tipLiability: z.number().int().nonnegative(),
    taxLiability: z.number().int().nonnegative(),
    driverReceivable: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (v) =>
      v.collectionBank + v.payoutBank + v.driverReceivable ===
      v.tipLiability + v.taxLiability,
    "Tip balances do not reconcile.",
  );
export const emptyTipBalances = {
  collectionBank: 0,
  payoutBank: 0,
  tipLiability: 0,
  taxLiability: 0,
  driverReceivable: 0,
};
export function tipJournalBalances(
  total: number,
  tip: number,
  refunds: number,
  refundedTip: number,
  paid: number,
) {
  if (
    ![total, tip, refunds, refundedTip, paid].every(Number.isSafeInteger) ||
    total < tip ||
    tip <= 0 ||
    refunds < 0 ||
    refunds > total ||
    refundedTip < 0 ||
    refundedTip > tip ||
    refunds < refundedTip ||
    refunds - refundedTip > total - tip ||
    paid < 0
  )
    throw Error("Invalid verified tip totals.");
  const owed = tip - refundedTip - paid;
  return tipBalances.parse({
    collectionBank: total - refunds,
    payoutBank: paid ? -paid : 0,
    tipLiability: Math.max(owed, 0),
    taxLiability: total - tip - (refunds - refundedTip),
    driverReceivable: Math.max(-owed, 0),
  });
}
const line = z.object({
  Amount: z
    .number()
    .positive()
    .max(1000000)
    .refine((v) => qboAmountCents(v) !== null),
  Description: z.string(),
  DetailType: z.literal("JournalEntryLineDetail"),
  JournalEntryLineDetail: z.object({
    PostingType: z.enum(["Debit", "Credit"]),
    AccountRef: z.object({ value: z.string().regex(/^\d{1,30}$/) }),
  }),
});
export const tipJournalPayload = z
  .object({
    DocNumber: z.string().regex(/^DT[a-f0-9]{19}$/),
    TxnDate: z.iso.date(),
    CurrencyRef: z.object({ value: z.literal("USD") }),
    Line: z.array(line).min(2).max(5),
  })
  .strict()
  .refine((p) => {
    const cents = p.Line.map(
      (l) =>
        qboAmountCents(l.Amount)! *
        (l.JournalEntryLineDetail.PostingType === "Debit" ? 1 : -1),
    );
    return (
      cents.reduce((a, b) => a + b, 0) === 0 &&
      new Set(p.Line.map((l) => l.JournalEntryLineDetail.AccountRef.value)).size ===
        p.Line.length
    );
  });
export function compileTipJournal(
  before: unknown,
  after: unknown,
  accounts: unknown,
  doc: string,
  date: string,
) {
  const a = tipBalances.parse(before),
    b = tipBalances.parse(after),
    m = tipJournalMapping.parse(accounts);
  const Line = tipAccountKeys.flatMap((k) => {
    const delta =
      (b[k] - a[k]) *
      (k === "collectionBank" || k === "payoutBank" || k === "driverReceivable" ? 1 : -1);
    return delta
      ? [
          {
            Amount: Math.abs(delta) / 100,
            Description: "DetergentsDelivered tip reconciliation: " + k,
            DetailType: "JournalEntryLineDetail" as const,
            JournalEntryLineDetail: {
              PostingType: delta > 0 ? "Debit" : "Credit",
              AccountRef: { value: m[k] },
            },
          },
        ]
      : [];
  });
  return Line.length
    ? tipJournalPayload.parse({
        DocNumber: doc,
        TxnDate: date,
        CurrencyRef: { value: "USD" },
        Line,
      })
    : null;
}
export function matchTipJournal(raw: unknown, expected: unknown) {
  const p = tipJournalPayload.parse(expected);
  const r = z
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
          line.extend({
            JournalEntryLineDetail: line.shape.JournalEntryLineDetail.extend({
              TaxAmount: z.number().optional(),
              TaxCodeRef: z.unknown().optional(),
            }),
          }),
        )
        .min(2)
        .max(5),
    })
    .parse(raw);
  if (
    r.DocNumber !== p.DocNumber ||
    r.TxnDate !== p.TxnDate ||
    r.CurrencyRef.value !== "USD" ||
    r.Adjustment ||
    r.HomeCurrencyAdjustment ||
    (r.TxnTaxDetail?.TotalTax ?? 0) !== 0 ||
    r.Line.length !== p.Line.length
  )
    throw Error("Journal identity differs.");
  for (const l of p.Line) {
    const rows = r.Line.filter(
      (x) =>
        x.JournalEntryLineDetail.AccountRef.value ===
        l.JournalEntryLineDetail.AccountRef.value,
    );
    const v = rows[0];
    if (
      rows.length !== 1 ||
      v.Description !== l.Description ||
      v.JournalEntryLineDetail.PostingType !== l.JournalEntryLineDetail.PostingType ||
      qboAmountCents(v.Amount) !== qboAmountCents(l.Amount) ||
      (v.JournalEntryLineDetail.TaxAmount ?? 0) !== 0 ||
      v.JournalEntryLineDetail.TaxCodeRef !== undefined
    )
      throw Error("Journal lines differ.");
  }
  return r.Id;
}
