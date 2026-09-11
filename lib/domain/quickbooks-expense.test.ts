import { expect, it } from "vitest";
import { matchQboExpense, qboAmountCents } from "./quickbooks-expense";
const payload = {
  DocNumber: "DD" + "a".repeat(19),
  TxnDate: "2026-09-01",
  PaymentType: "Cash",
  AccountRef: { value: "2" },
  CurrencyRef: { value: "USD" },
  Line: [
    {
      Amount: 12.34,
      Description: "Synthetic expense",
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: { AccountRef: { value: "1" } },
    },
  ],
};
const receipt = () => ({ ...payload, Id: "123", TotalAmt: 12.34 });
it("matches exact expense accounting evidence and decimal cents", () => {
  expect(qboAmountCents(12.34)).toBe(1234);
  expect(qboAmountCents(12.345)).toBeNull();
  expect(matchQboExpense(receipt(), payload)).toBe("123");
});
it("rejects changed money, currency, tax, description, account and document evidence", () => {
  for (const change of [
    { TotalAmt: 12.35 },
    { CurrencyRef: { value: "CAD" } },
    { TxnTaxDetail: { TotalTax: 1 } },
    { AccountRef: { value: "3" } },
    { DocNumber: "other" },
    { Credit: true },
    { Line: [{ ...payload.Line[0], Description: "other" }] },
  ])
    expect(() => matchQboExpense({ ...receipt(), ...change }, payload)).toThrow();
});
it("cannot confirm matching invalid fractional-cent amounts", () => {
  const invalid = { ...payload, Line: [{ ...payload.Line[0], Amount: 1.001 }] };
  expect(() =>
    matchQboExpense({ ...invalid, Id: "1", TotalAmt: 1.001 }, invalid),
  ).toThrow();
});
