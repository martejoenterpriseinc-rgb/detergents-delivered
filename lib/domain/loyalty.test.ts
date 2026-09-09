import { describe, expect, it } from "vitest";
import {
  dollarsToCents,
  programSchema,
  rewardAllocation,
  rewardQuoteSchema,
} from "./loyalty";
import { loginDestination, safeLoginCallback } from "./login-destination";
describe("loyalty money and login boundaries", () => {
  it("uses only the needed rewards and preserves the remainder", () => {
    expect(rewardAllocation(5000, 1234)).toEqual({
      appliedCents: 1234,
      remainingCents: 3766,
      payableCents: 0,
    });
    expect(rewardAllocation(1200, 3500)).toEqual({
      appliedCents: 1200,
      remainingCents: 0,
      payableCents: 2300,
    });
    expect(rewardAllocation(1000, 0)).toEqual({
      appliedCents: 0,
      remainingCents: 1000,
      payableCents: 0,
    });
    expect(rewardAllocation(0, 3500).appliedCents).toBe(0);
    for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => rewardAllocation(bad, 100)).toThrow();
  });
  it("parses exact dollar amounts without floating point balance errors", () => {
    expect(dollarsToCents("0.29")).toBe(29);
    expect(dollarsToCents("50.01")).toBe(5001);
    for (const bad of ["1.001", "1e3", "-5", "1,000", "Infinity"])
      expect(() => dollarsToCents(bad)).toThrow();
  });
  it("does not accept identity, balance or prices from a cart client", () => {
    expect(
      rewardQuoteSchema.safeParse({
        lines: [{ variantId: "sku", quantity: 1, unitPriceCents: 1 }],
      }).success,
    ).toBe(false);
    expect(
      rewardQuoteSchema.safeParse({
        lines: [{ variantId: "sku", quantity: 1 }],
        customerId: "other",
      }).success,
    ).toBe(false);
    expect(
      programSchema.safeParse({ enabled: true, referrerRewardCents: -1 }).success,
    ).toBe(false);
  });
  it("opens staff administration using persistent roles, never an email allowlist", () => {
    expect(loginDestination(["CUSTOMER", "SUPER_ADMIN"])).toBe("/admin");
    expect(loginDestination(["CUSTOMER"])).toBe("/account");
    expect(safeLoginCallback("/account")).toBe("/account");
    for (const bad of [
      null,
      "https://attacker.example",
      "//attacker.example",
      "/\\attacker.example",
      "/\nadmin",
    ])
      expect(safeLoginCallback(bad)).toBe("/account/entry");
  });
});
