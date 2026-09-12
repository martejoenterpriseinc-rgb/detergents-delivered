import { z } from "zod";
import { businessDate } from "./operations";
import { financeDayStart } from "./finance";
export const paymentCategories = {
  succeeded: "Succeeded",
  uncaptured: "Uncaptured",
  refunded: "Refunded",
  blocked: "Blocked",
  failed: "Failed",
  processing: "Processing",
  review: "Needs review",
  gross: "Gross volume",
  net: "Net volume",
  balance: "Balances",
} as const;
export const paymentCategory = z.enum(
  Object.keys(paymentCategories) as [
    keyof typeof paymentCategories,
    ...Array<keyof typeof paymentCategories>,
  ],
);
export function paymentPeriod(raw: unknown, today = businessDate()) {
  const period = z.enum(["day", "week", "month", "year"]).catch("month").parse(raw);
  let from = today;
  if (period === "month") from = today.slice(0, 7) + "-01";
  if (period === "year") from = today.slice(0, 4) + "-01-01";
  if (period === "week") {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    from = d.toISOString().slice(0, 10);
  }
  const end = new Date(today + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    period,
    from,
    to: today,
    start: financeDayStart(from),
    end: financeDayStart(end.toISOString().slice(0, 10)),
  };
}
