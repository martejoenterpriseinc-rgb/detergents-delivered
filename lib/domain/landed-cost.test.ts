import { describe, expect, it } from "vitest";
import { allocateLandedCost, lineMerchandiseCents } from "./landed-cost";
import { MoneyError } from "./money";

describe("landed cost allocation", () => {
  it("allocates header freight and fees by merchandise weight and keeps cents exact", () => {
    const result = allocateLandedCost(
      [
        { id: "a", quantity: 10, unitCostCents: 100, discountCents: 0 },
        { id: "b", quantity: 5, unitCostCents: 200 },
      ],
      { freightCents: 300, feeCents: 0, taxCents: 0, otherCostCents: 0 },
    );

    expect(result.merchandiseCents).toBe(2000);
    expect(result.headerCostCents).toBe(300);
    expect(result.landedTotalCents).toBe(2300);
    expect(result.lines[0]?.allocatedHeaderCents).toBe(150);
    expect(result.lines[1]?.allocatedHeaderCents).toBe(150);
    expect(result.lines[0]?.landedUnitCostCents).toBe(115);
    expect(result.lines[1]?.landedUnitCostCents).toBe(230);
    expect(
      result.lines.reduce((sum, line) => sum + line.allocatedHeaderCents, 0),
    ).toBe(300);
  });

  it("puts remainder cents on the last positive-qty line", () => {
    const result = allocateLandedCost(
      [
        { id: "a", quantity: 2, unitCostCents: 100 },
        { id: "b", quantity: 1, unitCostCents: 100 },
      ],
      { freightCents: 100 },
    );
    expect(result.lines[0]?.allocatedHeaderCents).toBe(66);
    expect(result.lines[1]?.allocatedHeaderCents).toBe(34);
    expect(result.landedTotalCents).toBe(400);
  });

  it("keeps line-level extras on that line only", () => {
    const result = allocateLandedCost(
      [
        { id: "a", quantity: 2, unitCostCents: 500, freightCents: 50 },
        { id: "b", quantity: 2, unitCostCents: 500 },
      ],
      { otherCostCents: 20 },
    );
    expect(result.lines[0]?.lineExtraCents).toBe(50);
    expect(result.lines[1]?.lineExtraCents).toBe(0);
    expect(result.landedTotalCents).toBe(2070);
  });

  it("keeps header costs on an empty draft with no lines yet", () => {
    const result = allocateLandedCost([], { freightCents: 250 });
    expect(result.lines).toEqual([]);
    expect(result.headerCostCents).toBe(250);
    expect(result.landedTotalCents).toBe(250);
  });

  it("rejects float money and discounts larger than merchandise", () => {
    expect(() => lineMerchandiseCents({ id: "a", quantity: 1, unitCostCents: 1.2 })).toThrow(
      MoneyError,
    );
    expect(() =>
      lineMerchandiseCents({ id: "a", quantity: 1, unitCostCents: 100, discountCents: 200 }),
    ).toThrow(MoneyError);
  });
});
