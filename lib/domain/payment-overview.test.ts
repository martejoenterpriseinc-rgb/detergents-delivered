import { expect, it } from "vitest";
import { paymentPeriod, paymentCategory } from "./payment-overview";
it("uses Chicago DST boundaries and Monday calendar weeks", () => {
  const day = paymentPeriod("day", "2026-03-08");
  expect(day.end.getTime() - day.start.getTime()).toBe(23 * 3600000);
  expect(paymentPeriod("week", "2026-09-13").from).toBe("2026-09-07");
  expect(paymentPeriod("year", "2026-09-12").from).toBe("2026-01-01");
});
it("defaults invalid periods and rejects unknown detail categories", () => {
  expect(paymentPeriod("invalid", "2026-09-12").period).toBe("month");
  expect(paymentCategory.safeParse("unknown").success).toBe(false);
});
import { paymentFilters, paymentQuery } from "./payment-overview";
it("validates custom ranges and keeps comparison days across DST and month/year changes", () => {
  const f = paymentFilters(
    { period: "custom", from: "2026-03-08", to: "2026-03-08", method: "ZELLE" },
    "2026-03-08",
  );
  expect(f.range.previousFrom).toBe("2026-03-07");
  expect(f.range.end.getTime() - f.range.start.getTime()).toBe(23 * 3600000);
  expect(paymentPeriod("previousMonth", "2026-01-02").from).toBe("2025-12-01");
  expect(paymentPeriod("yesterday", "2026-01-01").from).toBe("2025-12-31");
  expect(() =>
    paymentFilters({ period: "custom", from: "2026-02-30", to: "2026-03-01" }),
  ).toThrow();
  expect(() => paymentFilters({ page: -1 })).toThrow();
  expect(paymentQuery(f, { page: 2 })).toContain("method=ZELLE");
});
