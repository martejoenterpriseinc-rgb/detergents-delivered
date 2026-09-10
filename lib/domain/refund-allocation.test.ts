import { describe, expect, it } from "vitest";
import { allocateRefundLine, assertRefundCapacity } from "./refund-allocation";

describe("refund allocation conservation", () => {
  it("returns the exact saved net, tax and reward amounts across partial quantities", () => {
    for (let purchased = 1; purchased <= 100; purchased++) {
      const sums = { netCents: 0, taxCents: 0, cashCents: 0, rewardCents: 0 };
      for (let alreadyRefunded = 0; alreadyRefunded < purchased; alreadyRefunded++) {
        const result = allocateRefundLine({
          quantities: { purchased, alreadyRefunded, requested: 1 },
          netCents: 1001,
          taxCents: 83,
          rewardCents: 107,
        });
        for (const key of Object.keys(sums) as (keyof typeof sums)[])
          sums[key] += result[key];
      }
      expect(sums).toEqual({
        netCents: 1001,
        taxCents: 83,
        cashCents: 1084,
        rewardCents: 107,
      });
    }
  });
  it("has the same total for grouped and separate returns, including tiny amounts", () => {
    const base = { netCents: 1, taxCents: 1, rewardCents: 2 };
    const first = allocateRefundLine({
      ...base,
      quantities: { purchased: 3, alreadyRefunded: 0, requested: 2 },
    });
    const last = allocateRefundLine({
      ...base,
      quantities: { purchased: 3, alreadyRefunded: 2, requested: 1 },
    });
    expect(first.cashCents + last.cashCents).toBe(2);
    expect(first.rewardCents + last.rewardCents).toBe(2);
    expect(
      allocateRefundLine({
        netCents: 0,
        taxCents: 0,
        rewardCents: 1500,
        quantities: { purchased: 1, alreadyRefunded: 0, requested: 1 },
      }),
    ).toEqual({ netCents: 0, taxCents: 0, cashCents: 0, rewardCents: 1500 });
  });
  it("rejects negative, fractional, repeated and excessive quantities or cents", () => {
    const valid = {
      quantities: { purchased: 3, alreadyRefunded: 0, requested: 1 },
      netCents: 100,
      taxCents: 8,
      rewardCents: 10,
    };
    for (const patch of [
      { netCents: -1 },
      { taxCents: 0.1 },
      { rewardCents: NaN },
      { quantities: { purchased: 3, alreadyRefunded: 3, requested: 1 } },
      { quantities: { purchased: 0, alreadyRefunded: 0, requested: 1 } },
    ])
      expect(() => allocateRefundLine({ ...valid, ...patch })).toThrow();
  });
  it("reserves uncertain provider requests against the same captured funds", () => {
    expect(
      assertRefundCapacity({
        capturedCents: 1000,
        settledCents: 300,
        unresolvedCents: 400,
        requestedCents: 300,
      }),
    ).toBe(0);
    expect(() =>
      assertRefundCapacity({
        capturedCents: 1000,
        settledCents: 300,
        unresolvedCents: 400,
        requestedCents: 301,
      }),
    ).toThrow();
    expect(() =>
      assertRefundCapacity({
        capturedCents: 1000,
        settledCents: -300,
        unresolvedCents: 0,
        requestedCents: 1000,
      }),
    ).toThrow();
  });
});
