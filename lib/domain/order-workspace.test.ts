import { describe, expect, it } from "vitest";
import { orderFilters, orderMoney } from "./order-workspace";
describe("order workspace filters", () => {
  it("keeps all history available by default", () => {
    expect(orderFilters.parse({})).toMatchObject({
      q: "",
      status: "ALL",
      view: "all",
      page: 1,
    });
    expect(orderFilters.parse({ from: "", to: "" }).from).toBeUndefined();
  });
  it("rejects invalid dates, statuses, unbounded input and extra selectors", () => {
    for (const input of [
      { from: "2026-02-30" },
      { from: "2026-02-10", to: "2026-02-01" },
      { status: "approved" },
      { page: 0 },
      { page: 100001 },
      { q: "x".repeat(101) },
      { customerId: "arbitrary" },
    ])
      expect(orderFilters.safeParse(input).success).toBe(false);
  });
  it("preserves currency instead of adding unlike monetary units", () => {
    expect(orderMoney(1234, "USD")).toBe("12.34 USD");
    expect(orderMoney(1234, "CAD")).toBe("12.34 CAD");
  });
});
