import { expect, it } from "vitest";
import {
  tipJournalBalances,
  compileTipJournal,
  emptyTipBalances,
  matchTipJournal,
} from "./tip-journal";
const accounts = {
    collectionBank: "1",
    payoutBank: "2",
    tipLiability: "3",
    taxLiability: "4",
    driverReceivable: "5",
  },
  doc = "DT" + "a".repeat(19),
  date = "2026-09-18";
it("keeps tax out of driver pay and recognizes a receivable when a paid tip is refunded", () => {
  const collected = tipJournalBalances(108, 100, 0, 0, 0),
    paid = tipJournalBalances(108, 100, 0, 0, 100),
    refunded = tipJournalBalances(108, 100, 108, 100, 100),
    recovered = tipJournalBalances(108, 100, 108, 100, 0);
  expect(collected).toEqual({
    collectionBank: 108,
    payoutBank: 0,
    tipLiability: 100,
    taxLiability: 8,
    driverReceivable: 0,
  });
  expect(paid).toEqual({ ...collected, payoutBank: -100, tipLiability: 0 });
  expect(refunded).toEqual({
    collectionBank: 0,
    payoutBank: -100,
    tipLiability: 0,
    taxLiability: 0,
    driverReceivable: 100,
  });
  expect(recovered).toEqual(emptyTipBalances);
  for (const [a, b] of [
    [emptyTipBalances, collected],
    [collected, paid],
    [paid, refunded],
    [refunded, recovered],
  ]) {
    const p = compileTipJournal(a, b, accounts, doc, date)!;
    expect(
      p.Line.reduce(
        (n, l) =>
          n +
          Math.round(l.Amount * 100) *
            (l.JournalEntryLineDetail.PostingType === "Debit" ? 1 : -1),
        0,
      ),
    ).toBe(0);
    expect(matchTipJournal({ ...p, Id: "123" }, p)).toBe("123");
  }
  expect(compileTipJournal(paid, paid, accounts, doc, date)).toBeNull();
});
it("rejects impossible allocations, duplicate accounts and altered provider postings", () => {
  for (const args of [
    [108, 100, 54, 40, 0],
    [108, 100, 109, 100, 0],
    [108, 100, 54, 55, 0],
    [108, 100, 0, 0, -1],
  ])
    expect(() =>
      tipJournalBalances(...(args as [number, number, number, number, number])),
    ).toThrow();
  const b = tipJournalBalances(108, 100, 54, 50, 0);
  expect(b.tipLiability).toBe(50);
  expect(b.taxLiability).toBe(4);
  expect(() =>
    compileTipJournal(emptyTipBalances, b, { ...accounts, payoutBank: "1" }, doc, date),
  ).toThrow();
  const p = compileTipJournal(emptyTipBalances, b, accounts, doc, date)!;
  for (const patch of [
    { CurrencyRef: { value: "CAD" } },
    { DocNumber: "DT" + "b".repeat(19) },
    { HomeCurrencyAdjustment: true },
    { TxnTaxDetail: { TotalTax: 1 } },
    { Line: p.Line.slice(1) },
  ])
    expect(() => matchTipJournal({ ...p, Id: "123", ...patch }, p)).toThrow();
  const altered = structuredClone(p);
  altered.Line[0].Amount += 0.01;
  expect(() => matchTipJournal({ ...altered, Id: "123" }, p)).toThrow();
});
