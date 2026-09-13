import { z } from "zod";
import { businessDate } from "./operations";
import { financeDayStart, financeFilters } from "./finance";
export const paymentCategories = {
  gross: "Gross collected",
  refunded: "Refunds and corrections",
  net: "Net collected after refunds",
  fees: "Processing fees",
  netAfterFees: "Net after fees",
  succeeded: "Successful payments",
  processing: "Processing payments",
  uncaptured: "Uncaptured payments",
  declined: "Declined payments",
  blocked: "Blocked payments",
  failed: "Failed payments",
  canceled: "Canceled payments",
  disputed: "Disputed payments",
  refundPending: "Pending refunds",
  refundCompleted: "Completed refunds",
  refundFailed: "Failed refunds",
  cash: "Cash collected",
  zelle: "Zelle collected",
  approvals: "Pending approvals",
  manualPending: "Pending manual payments",
  review: "Settlement exceptions",
  tips: "Tips collected",
  tipRefunded: "Tip refunds",
  tipAwaiting: "Tips awaiting payout",
  tipPaid: "Tips paid out",
  balance: "Available balance",
  pendingBalance: "Pending balance",
  payouts: "Provider payouts",
  newCustomers: "New paying customers",
  customers: "Top customers by spend",
} as const;
export type PaymentCategory = keyof typeof paymentCategories;
export const paymentCategory = z.enum(
  Object.keys(paymentCategories) as [PaymentCategory, ...PaymentCategory[]],
);
export const unavailableMetrics: Partial<Record<PaymentCategory, string>> = {
  fees: "Verified processing-fee records have not been imported.",
  netAfterFees:
    "Verified processing fees are required; net collected is not a bank deposit.",
  declined:
    "Decline-code evidence is not imported. Failed payments are not automatically declines.",
  blocked:
    "Verified fraud-block evidence is not imported. Failed or review records are not fraud blocks.",
  canceled:
    "Provider payment-cancellation evidence is not imported. Expired checkouts are not canceled payments.",
  disputed:
    "Verified dispute records are not imported. Disputes must not be inferred from payment failures.",
  approvals:
    "There is no environment-scoped customer approval-request queue. Existing cash/Zelle permissions are managed on customer accounts.",
  tipAwaiting:
    "Payable tip balances require current refund, dispute and tax-allocation verification. These paid tips need reconciliation; no payout amount is asserted.",
  balance:
    "Current account-wide available balance requires the provider connection. It is not period-filtered order revenue.",
  pendingBalance:
    "Current account-wide pending balance requires the provider connection.",
  payouts:
    "Verified provider payout records are not imported. Driver transfer records are reported separately.",
};
const presets = [
  "day",
  "yesterday",
  "week",
  "month",
  "previousMonth",
  "year",
  "custom",
] as const;
export function addDays(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function paymentPeriod(
  raw: unknown,
  today = businessDate(),
  custom?: { from?: string; to?: string },
) {
  const period = z.enum(presets).catch("month").parse(raw);
  let from = today,
    to = today;
  if (period === "yesterday") from = to = addDays(today, -1);
  if (period === "month") from = today.slice(0, 7) + "-01";
  if (period === "year") from = today.slice(0, 4) + "-01-01";
  if (period === "previousMonth") {
    to = addDays(today.slice(0, 7) + "-01", -1);
    from = to.slice(0, 7) + "-01";
  }
  if (period === "week")
    from = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
  if (period === "custom") {
    const f = financeFilters({ from: custom?.from, to: custom?.to });
    from = f.from;
    to = f.to;
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  return {
    period,
    from,
    to,
    start: financeDayStart(from),
    end: financeDayStart(addDays(to, 1)),
    previousFrom: addDays(from, -days),
    previousTo: addDays(from, -1),
    previousStart: financeDayStart(addDays(from, -days)),
  };
}
export function paymentFilters(raw: unknown, today = businessDate()) {
  const f = z
    .object({
      period: z.enum(presets).default("month"),
      from: z.string().optional(),
      to: z.string().optional(),
      method: z.enum(["ALL", "STRIPE", "CASH", "ZELLE"]).default("ALL"),
      q: z.string().trim().max(100).default(""),
      sort: z.enum(["newest", "oldest", "amountDesc", "amountAsc"]).default("newest"),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      interval: z.enum(["day", "week", "month"]).default("day"),
      customer: z.string().max(100).optional(),
    })
    .strict()
    .parse(raw);
  return { ...f, range: paymentPeriod(f.period, today, f) };
}
export type PaymentFilters = ReturnType<typeof paymentFilters>;
export function paymentQuery(
  f: PaymentFilters,
  overrides: Record<string, string | number | undefined> = {},
) {
  const { range: _range, ...fields } = f;
  void _range;
  return new URLSearchParams(
    Object.entries({ ...fields, ...overrides })
      .filter((x): x is [string, string | number] => x[1] !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
