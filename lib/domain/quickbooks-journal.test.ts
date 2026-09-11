import { expect, it } from "vitest";
import { journalPayload, matchCostJournal } from "./quickbooks-journal";
const payload = {
  DocNumber: "DC" + "a".repeat(19),
  TxnDate: "2026-02-01",
  CurrencyRef: { value: "USD" },
  Line: [
    {
      Amount: 15.01,
      Description: "Original sale cost",
      DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "1" } },
    },
    {
      Amount: 15.01,
      Description: "Original sale cost",
      DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "2" } },
    },
  ],
};
it("requires a balanced two-line journal and matches exact cents even if provider lines reorder", () => {
  expect(journalPayload.parse(payload).Line).toHaveLength(2);
  expect(
    matchCostJournal(
      { Id: "123", ...payload, Line: [...payload.Line].reverse() },
      payload,
    ),
  ).toBe("123");
  expect(() =>
    journalPayload.parse({
      ...payload,
      Line: [payload.Line[0], { ...payload.Line[1], Amount: 15.02 }],
    }),
  ).toThrow();
});
it("rejects mismatched identity, date, currency, accounts, tax, amount and duplicate sides", () => {
  for (const bad of [
    { DocNumber: "other" },
    { TxnDate: "2026-02-02" },
    { CurrencyRef: { value: "EUR" } },
    { Adjustment: true },
    { HomeCurrencyAdjustment: true },
    { TxnTaxDetail: { TotalTax: 1 } },
    { Line: [payload.Line[0], payload.Line[0]] },
    { Line: [{ ...payload.Line[0], Amount: 15.011 }, payload.Line[1]] },
    {
      Line: [
        {
          ...payload.Line[0],
          JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "99" } },
        },
        payload.Line[1],
      ],
    },
  ])
    expect(() => matchCostJournal({ Id: "123", ...payload, ...bad }, payload)).toThrow();
});
