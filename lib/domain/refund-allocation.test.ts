import { describe, expect, it } from "vitest";
import {
  allocateRefundLine,
  allocateRemainingRefundLine,
  assertRefundCapacity,
  refundRequestInput,
  stockReturnInput,
} from "./refund-allocation";

describe("refund allocation conservation", () => {
  it("conserves saved cents after canceling arbitrary earlier partial reservations", () => {
    for (let purchased = 2; purchased <= 100; purchased++) {
      const saved = { netCents: 1001, taxCents: 83, rewardCents: 107 };
      const held = Array.from({ length: purchased }, (_, alreadyRefunded) =>
        allocateRefundLine({
          ...saved,
          quantities: { purchased, alreadyRefunded, requested: 1 },
        }),
      ).filter((_, index) => index % 2);
      const allocated = held.reduce(
        (sum, part) => ({
          netCents: sum.netCents + part.netCents,
          taxCents: sum.taxCents + part.taxCents,
          rewardCents: sum.rewardCents + part.rewardCents,
        }),
        { netCents: 0, taxCents: 0, rewardCents: 0 },
      );
      const remainder = allocateRemainingRefundLine({
        ...saved,
        allocated,
        quantities: {
          purchased,
          alreadyRefunded: held.length,
          requested: purchased - held.length,
        },
      });
      for (const key of ["netCents", "taxCents", "rewardCents"] as const)
        expect(allocated[key] + remainder[key]).toBe(saved[key]);
    }
  });
  it("rejects inconsistent saved allocations", () => {
    const input = {
      netCents: 100,
      taxCents: 8,
      rewardCents: 0,
      quantities: { purchased: 3, alreadyRefunded: 1, requested: 1 },
      allocated: { netCents: 101, taxCents: 0, rewardCents: 0 },
    };
    expect(() => allocateRemainingRefundLine(input)).toThrow();
    expect(() =>
      allocateRemainingRefundLine({
        ...input,
        quantities: { ...input.quantities, alreadyRefunded: 0 },
        allocated: { netCents: 1, taxCents: 0, rewardCents: 0 },
      }),
    ).toThrow();
  });
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

  it("accepts only bounded, unique line requests and explicit return condition", () => {
    const line = { orderItemId: "item-1", quantity: 1 };
    expect(
      refundRequestInput.parse({
        requestKey: "11111111-1111-4111-8111-111111111111",
        orderId: "order-1",
        paymentId: "payment-1",
        reason: "Customer returned an unopened item",
        lines: [line],
      }),
    ).toMatchObject({ lines: [line] });
    expect(
      refundRequestInput.safeParse({
        requestKey: "11111111-1111-4111-8111-111111111111",
        orderId: "order-1",
        paymentId: "payment-1",
        reason: "Customer returned an unopened item",
        lines: [line, line],
      }).success,
    ).toBe(false);
    expect(
      stockReturnInput.safeParse({
        requestKey: "11111111-1111-4111-8111-111111111111",
        orderId: "order-1",
        reason: "Customer returned an unopened item",
        lines: [{ ...line, condition: "UNKNOWN" }],
      }).success,
    ).toBe(false);
  });
});
