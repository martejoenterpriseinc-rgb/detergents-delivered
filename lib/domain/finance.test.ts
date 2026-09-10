import { describe, it, expect } from "vitest";
import { financeFilters, financeInput, financeDayStart } from "./finance";
const expense = {
  kind: "expense",
  requestKey: "b6a794fa-41bd-44d7-a6ba-bae528bdf618",
  version: 0,
  date: "2026-01-15",
  category: " Supplies ",
  amount: "12.34",
  memo: "Receipt 1",
};
describe("finance input", () => {
  it("uses Chicago day boundaries through both DST transitions", () => {
    expect(
      financeDayStart("2026-03-09").getTime() - financeDayStart("2026-03-08").getTime(),
    ).toBe(23 * 3600000);
    expect(
      financeDayStart("2026-11-02").getTime() - financeDayStart("2026-11-01").getTime(),
    ).toBe(25 * 3600000);
  });
  it("converts decimal strings exactly to cents", () => {
    expect(financeInput.parse(expense)).toMatchObject({
      amount: 1234,
      category: "supplies",
    });
    expect(financeInput.parse({ ...expense, amount: "0.29" })).toMatchObject({
      amount: 29,
    });
  });
  it.each(["0", "-1", "1.001", "1e3", "NaN", "1000000.01"])(
    "rejects invalid amount %s",
    (amount) =>
      expect(financeInput.safeParse({ ...expense, amount }).success).toBe(false),
  );
  it("requires valid dates and explanations for corrections", () => {
    expect(financeInput.safeParse({ ...expense, date: "2026-02-30" }).success).toBe(
      false,
    );
    expect(financeInput.safeParse({ ...expense, date: "2999-01-01" }).success).toBe(
      false,
    );
    expect(financeInput.safeParse({ ...expense, id: "expense1" }).success).toBe(false);
    expect(
      financeInput.safeParse({ ...expense, id: "expense1", reason: "Corrected receipt" })
        .success,
    ).toBe(true);
  });
  it("rejects empty, reversed, fractional and implausible odometers", () => {
    const trip = {
      kind: "mileage",
      requestKey: expense.requestKey,
      version: 0,
      date: expense.date,
      vehicleId: "vehicle",
      purpose: "Delivery run",
      startOdometer: 100,
      endOdometer: 120,
    };
    expect(financeInput.safeParse(trip).success).toBe(true);
    for (const endOdometer of [99, 100, 120.5, 10101])
      expect(financeInput.safeParse({ ...trip, endOdometer }).success).toBe(false);
  });
  it("bounds list/export dates and rejects unknown filters", () => {
    expect(() => financeFilters({ from: "2025-01-01", to: "2026-12-31" })).toThrow();
    expect(() => financeFilters({ from: "2026-02-01", to: "2026-01-01" })).toThrow();
    expect(() => financeFilters({ page: 0 })).toThrow();
    expect(() => financeFilters({ userId: "other" })).toThrow();
  });
});
