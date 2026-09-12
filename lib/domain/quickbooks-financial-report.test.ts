import { expect, it } from "vitest";
import { parseFinancialReport, reportMoney } from "./quickbooks-financial-report";
const request = {
  name: "ProfitAndLoss" as const,
  from: "2026-09-01",
  to: "2026-09-12",
  basis: "Accrual" as const,
};
const report = () => ({
  Header: {
    ReportName: request.name,
    StartPeriod: request.from,
    EndPeriod: request.to,
    ReportBasis: request.basis,
    Currency: "USD",
    Option: [{ Name: "NoReportData", Value: "false" }],
  },
  Columns: {
    Column: [
      { ColTitle: "Account", ColType: "Account" },
      { ColTitle: "Total", ColType: "Money" },
    ],
  },
  Rows: {
    Row: [
      {
        type: "Section",
        group: "Income",
        Header: { ColData: [{ value: "Income" }, { value: "" }] },
        Rows: {
          Row: [{ type: "Data", ColData: [{ value: "Sales" }, { value: "100.05" }] }],
        },
        Summary: { ColData: [{ value: "Total income" }, { value: "100.05" }] },
      },
    ],
  },
});
it("preserves provider totals and linked detail sections without summing parent and child rows", () => {
  const parsed = parseFinancialReport(report(), request);
  expect(parsed.metrics).toEqual([
    { id: "0:1", label: "Total income", section: "0", cents: 10005, column: "Total" },
  ]);
  expect(parsed.rows.map((r) => r.kind)).toEqual(["header", "data", "summary"]);
  expect(parsed.rows[1].section).toBe("0.0");
});
it("rejects another period, currency, report, accounting basis or filtered company scope", () => {
  for (const change of [
    { Currency: "EUR" },
    { StartPeriod: "2026-08-01" },
    { EndPeriod: "2026-09-11" },
    { ReportName: "BalanceSheet" },
    { ReportBasis: "Cash" },
    { Customer: "123" },
  ]) {
    const data = report();
    Object.assign(data.Header, change);
    expect(() => parseFinancialReport(data, request)).toThrow();
  }
});
it("distinguishes no data and blank values from genuine zero", () => {
  const data = report();
  data.Header.Option[0].Value = "true";
  expect(parseFinancialReport(data, request)).toMatchObject({
    noData: true,
    metrics: [],
  });
  expect(reportMoney("")).toBeNull();
  expect(reportMoney("0.00")).toBe(0);
  expect(reportMoney("-100.05")).toBe(-10005);
  for (const value of ["$1", "1,000", "NaN", "1e3", "0.001"])
    expect(() => reportMoney(value)).toThrow();
});
it("refuses malformed, overlarge or ambiguous report rows", () => {
  const data = report();
  data.Rows.Row[0].Summary.ColData.pop();
  expect(() => parseFinancialReport(data, request)).toThrow();
  const duplicate = report();
  duplicate.Header.Option.push({ Name: "NoReportData", Value: "false" });
  expect(() => parseFinancialReport(duplicate, request)).toThrow();
  const huge = report();
  huge.Rows.Row = Array.from({ length: 1001 }, () => report().Rows.Row[0]);
  expect(() => parseFinancialReport(huge, request)).toThrow();
});
it("validates an as-of balance without imposing a period-start filter", () => {
  const data = report();
  data.Header.ReportName = "BalanceSheet" as typeof request.name;
  data.Header.StartPeriod = "1970-01-01";
  expect(
    parseFinancialReport(data, { ...request, name: "BalanceSheet" }).header.EndPeriod,
  ).toBe(request.to);
});
