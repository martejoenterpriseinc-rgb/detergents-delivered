import { z } from "zod";
import { AccountError } from "./account";
import { paymentPeriod } from "./payment-overview";
export const financialReports = {
  ProfitAndLoss: "Profit and loss",
  BalanceSheet: "Balance sheet",
  CashFlow: "Cash flow",
  AgedReceivables: "Receivables aging",
  AgedPayables: "Payables aging",
  InventoryValuationSummary: "Inventory valuation",
  TrialBalance: "Trial balance",
} as const;
export const financialReportName = z.enum([
  "ProfitAndLoss",
  "BalanceSheet",
  "CashFlow",
  "AgedReceivables",
  "AgedPayables",
  "InventoryValuationSummary",
  "TrialBalance",
]);
export type FinancialReportName = z.infer<typeof financialReportName>;
export function financialReportFilters(raw: unknown) {
  const input = z
    .object({
      report: financialReportName.default("ProfitAndLoss"),
      period: z
        .enum(["day", "yesterday", "week", "month", "previousMonth", "year", "custom"])
        .default("month"),
      basis: z.enum(["Cash", "Accrual"]).default("Accrual"),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .strict()
    .parse(raw);
  if (input.period === "custom" && (!input.from || !input.to))
    throw new AccountError("Choose both dates for a custom report.", 400);
  return { ...input, range: paymentPeriod(input.period, undefined, input) };
}

export function financialReportRows(
  report: ReturnType<typeof parseFinancialReport>,
  section?: string,
) {
  if (section === undefined || section === "") return report.rows;
  if (!report.metrics.some((metric) => metric.section === section))
    throw new AccountError(
      "This report section is no longer available. Refresh the report.",
      409,
    );
  return report.rows.filter(
    (row) => row.section === section || row.section.startsWith(section + "."),
  );
}
export const reportUsesRange = (name: FinancialReportName) =>
  name === "ProfitAndLoss" || name === "CashFlow";
export const reportUsesBasis = (name: FinancialReportName) =>
  ["ProfitAndLoss", "BalanceSheet", "TrialBalance"].includes(name);
const fail = () =>
  new AccountError(
    "QuickBooks returned an incomplete or mismatched financial report. No totals were estimated.",
    409,
  );
const cell = z.object({ value: z.string().max(1000).optional() });
const cells = z.array(cell).max(32);
const rowSchema = z.object({
  type: z.string().optional(),
  group: z.string().max(100).optional(),
  Header: z.object({ ColData: cells }).optional(),
  Summary: z.object({ ColData: cells }).optional(),
  ColData: cells.optional(),
  Rows: z.object({ Row: z.array(z.unknown()).max(1000) }).optional(),
});
export function reportMoney(value: string) {
  if (value === "") return null;
  if (!/^-?\d{1,12}(?:\.\d{1,2})?$/.test(value)) throw fail();
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const n =
    (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) *
    (value.startsWith("-") ? -1 : 1);
  if (!Number.isSafeInteger(n)) throw fail();
  return n;
}
export function parseFinancialReport(
  raw: unknown,
  request: {
    name: FinancialReportName;
    from: string;
    to: string;
    basis: "Cash" | "Accrual";
  },
) {
  const parsed = z
    .object({
      Header: z.object({
        ReportName: z.string(),
        Currency: z.literal("USD"),
        StartPeriod: z.string().optional(),
        EndPeriod: z.string(),
        ReportBasis: z.string().optional(),
        Option: z.array(z.object({ Name: z.string(), Value: z.string() })).max(30),
        Customer: z.string().optional(),
        Vendor: z.string().optional(),
        Employee: z.string().optional(),
        Item: z.string().optional(),
        Class: z.string().optional(),
        Department: z.string().optional(),
      }),
      Columns: z.object({
        Column: z
          .array(z.object({ ColTitle: z.string().max(200), ColType: z.string().max(80) }))
          .min(2)
          .max(32),
      }),
      Rows: z.object({ Row: z.array(z.unknown()).max(1000).optional() }),
    })
    .safeParse(raw);
  if (!parsed.success) throw fail();
  const {
    Header: header,
    Columns: { Column: columns },
    Rows,
  } = parsed.data;
  const empty = header.Option.filter((o) => o.Name === "NoReportData");
  if (
    header.ReportName !== request.name ||
    header.EndPeriod !== request.to ||
    (reportUsesRange(request.name) && header.StartPeriod !== request.from) ||
    (reportUsesBasis(request.name) && header.ReportBasis !== request.basis) ||
    empty.length !== 1 ||
    !["true", "false"].includes(empty[0].Value) ||
    [
      header.Customer,
      header.Vendor,
      header.Employee,
      header.Item,
      header.Class,
      header.Department,
    ].some(Boolean)
  )
    throw fail();
  const rows: {
    id: string;
    section: string;
    kind: "header" | "data" | "summary";
    depth: number;
    values: string[];
  }[] = [];
  const metrics: {
    id: string;
    label: string;
    section: string;
    cents: number | null;
    column: string;
  }[] = [];
  let count = 0;
  function walk(rawRows: unknown[], prefix = "", depth = 0) {
    if (depth > 10) throw fail();
    rawRows.forEach((rawRow, index) => {
      if (++count > 1000) throw fail();
      const r = rowSchema.safeParse(rawRow);
      if (!r.success) throw fail();
      const section = prefix ? prefix + "." + index : String(index);
      const add = (data: z.infer<typeof cells>, kind: "header" | "data" | "summary") => {
        if (data.length !== columns.length) throw fail();
        const values = data.map((c) => c.value ?? "");
        columns.forEach((c, i) => {
          if (c.ColType === "Money") reportMoney(values[i]);
        });
        rows.push({ id: section + ":" + kind, section, kind, depth, values });
        if (kind === "summary")
          columns.forEach((c, i) => {
            if (c.ColType === "Money")
              metrics.push({
                id: section + ":" + i,
                label: values[0] || r.data.group || "Report total",
                section,
                cents: reportMoney(values[i]),
                column: c.ColTitle,
              });
          });
      };
      if (r.data.Header) add(r.data.Header.ColData, "header");
      if (r.data.ColData) add(r.data.ColData, "data");
      if (r.data.Rows) walk(r.data.Rows.Row, section, depth + 1);
      if (r.data.Summary) add(r.data.Summary.ColData, "summary");
    });
  }
  walk(Rows.Row ?? []);
  if (metrics.length > 250 || (empty[0].Value === "false" && !rows.length)) throw fail();
  return {
    header,
    columns,
    rows,
    metrics: empty[0].Value === "true" ? [] : metrics,
    noData: empty[0].Value === "true",
  };
}
