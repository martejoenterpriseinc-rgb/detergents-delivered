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
