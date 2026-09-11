import { describe, expect, it } from "vitest";
import { effectiveRefundCents, refundTransition } from "./refund-settlement";

describe("refund accounting transitions", () => {
  it("distinguishes pending, success, failure and success compensation", () => {
    expect(refundTransition("UNKNOWN", "pending")).toEqual({
      target: "PENDING",
      settle: false,
      compensate: false,
    });
    expect(refundTransition("PENDING", "succeeded")).toEqual({
      target: "SUCCEEDED",
      settle: true,
      compensate: false,
    });
    expect(refundTransition("SUCCEEDED", "failed")).toEqual({
      target: "FAILED",
      settle: false,
      compensate: true,
    });
    expect(refundTransition("UNKNOWN", "failed")).toEqual({
      target: "FAILED",
      settle: false,
      compensate: false,
    });
    expect(refundTransition("SUCCEEDED", "succeeded")).toEqual({
      target: "SUCCEEDED",
      settle: false,
      compensate: false,
    });
  });
  it("rejects stale success and pre-submission settlement", () => {
    for (const state of ["FAILED", "CANCELED", "PREPARED"] as const)
      expect(() => refundTransition(state, "succeeded")).toThrow();
    for (const status of ["pending", "requires_action"] as const)
      expect(() => refundTransition("SUCCEEDED", status)).toThrow();
  });
  it("retains gross evidence while computing compensated amounts", () => {
    expect(effectiveRefundCents({ amountCents: 1080 })).toBe(1080);
    expect(
      effectiveRefundCents({
        amountCents: 1080,
        request: {
          adjustments: [
            { kind: "SETTLEMENT", cashCents: 1080 },
            { kind: "COMPENSATION", cashCents: -1080 },
          ],
        },
      }),
    ).toBe(0);
    expect(() =>
      effectiveRefundCents({
        amountCents: 1080,
        request: { adjustments: [{ kind: "COMPENSATION", cashCents: -1081 }] },
      }),
    ).toThrow();
  });
});
