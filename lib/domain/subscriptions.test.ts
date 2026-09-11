import { describe, it, expect } from "vitest";
import { quarterDate, upcomingQuarter, subscriptionCreateInput } from "./subscriptions";
describe("quarterly calendar scheduling", () => {
  it("preserves the original month day after shorter months and leap years", () => {
    expect(quarterDate("2026-01-31", 1)).toBe("2026-04-30");
    expect(quarterDate("2026-01-31", 2)).toBe("2026-07-31");
    expect(quarterDate("2027-11-30", 1)).toBe("2028-02-29");
    expect(quarterDate("2027-11-30", 2)).toBe("2028-05-30");
  });
  it("resumes on the next future quarter without catch-up charges or day drift", () => {
    expect(upcomingQuarter("2026-01-31", 1, "2026-07-31")).toEqual({
      cycle: 3,
      date: "2026-10-31",
    });
    expect(upcomingQuarter("2026-01-31", 4, "2026-09-10")).toEqual({
      cycle: 4,
      date: "2027-01-31",
    });
  });
  it("rejects invalid dates, cadence overrides and missing consent", () => {
    expect(() => quarterDate("2026-02-30", 1)).toThrow();
    expect(() => quarterDate("2026-01-01", 0)).toThrow();
    expect(
      subscriptionCreateInput.safeParse({
        requestKey: "7338d354-9c66-4683-8e04-3f0158357186",
        originOrderId: "order",
        accepted: false,
        consentVersion: "quarterly-pay-at-purchase-v1",
      }).success,
    ).toBe(false);
  });
});
