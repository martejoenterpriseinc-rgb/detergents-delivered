import { describe, it, expect } from "vitest";
import { discountForPromotion, promotionSchema, type PromotionTerms } from "./promotions";
import { pickCurrentPrice } from "@/lib/prices";
import { rewardAllocation } from "./loyalty";
const p: PromotionTerms = {
  code: "OCTOBER",
  name: "October offer",
  valueType: "PERCENT",
  value: 1000,
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  minimumPurchaseCents: 0,
  maximumDiscountCents: null,
  audience: "ALL",
  allowRewards: true,
  isActive: true,
  version: 0,
};
const facts = { hasPriorOrder: false, referred: false };
describe("promotions and accumulated dollar rewards", () => {
  it("rounds percentage cents and caps fixed offers at merchandise due", () => {
    expect(discountForPromotion(p, 1005, "2026-10-31", facts)).toBe(101);
    expect(
      discountForPromotion(
        { ...p, valueType: "FIXED", value: 2000 },
        1005,
        "2026-10-01",
        facts,
      ),
    ).toBe(1005);
    expect(
      discountForPromotion({ ...p, maximumDiscountCents: 50 }, 1005, "2026-10-31", facts),
    ).toBe(50);
  });
  it("preserves excess rewards after the promotion", () => {
    const discount = discountForPromotion(p, 5000, "2026-10-15", facts);
    expect(rewardAllocation(8000, 5000 - discount)).toEqual({
      appliedCents: 4500,
      remainingCents: 3500,
      payableCents: 0,
    });
  });
  it("rejects expired, future, paused, ineligible and below-minimum offers", () => {
    for (const date of ["2026-09-30", "2026-11-01"])
      expect(() => discountForPromotion(p, 5000, date, facts)).toThrow();
    for (const patch of [
      { isActive: false },
      { minimumPurchaseCents: 6000 },
      { audience: "REFERRED" as const },
    ])
      expect(() =>
        discountForPromotion({ ...p, ...patch }, 5000, "2026-10-15", facts),
      ).toThrow();
    expect(() =>
      discountForPromotion({ ...p, audience: "FIRST_ORDER" }, 5000, "2026-10-15", {
        ...facts,
        hasPriorOrder: true,
      }),
    ).toThrow();
  });
  it("rejects percentages above 100 and reversed dates", () => {
    expect(promotionSchema.safeParse({ ...p, value: 10001 }).success).toBe(false);
    expect(promotionSchema.safeParse({ ...p, endsOn: "2026-09-01" }).success).toBe(false);
  });
});

it("does not display or quote a non-USD price as dollars", () => {
  expect(
    pickCurrentPrice([
      {
        kind: "RETAIL",
        amountCents: 5000,
        startsAt: new Date(0),
        endsAt: null,
        currency: "EUR",
      },
    ]),
  ).toBeNull();
});
