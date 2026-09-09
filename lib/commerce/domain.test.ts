import { describe, it, expect, vi } from "vitest";
import { allocateCents, checkoutInput } from "./domain";
import { commerceConfiguration, requireCommerce } from "./config";
describe("checkout money and activation", () => {
  it("allocates fractional discounts exactly once with deterministic ties", () => {
    expect(allocateCents(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocateCents(100, [333, 333, 334])).toEqual([33, 33, 34]);
  });
  it("caps full discounts and supports zero balances", () => {
    expect(allocateCents(100, [35, 65])).toEqual([35, 65]);
    expect(allocateCents(0, [0, 0])).toEqual([0, 0]);
    expect(() => allocateCents(101, [100])).toThrow();
  });
  it("rejects browser price fields and duplicate cart lines", () => {
    const input = {
      requestKey: "6cc65bf7-a657-44be-8632-77222e899f20",
      addressId: "address",
      useRewards: false,
      lines: [{ variantId: "v", quantity: 1 }],
    };
    expect(checkoutInput.safeParse({ ...input, totalCents: 1 }).success).toBe(false);
    expect(
      checkoutInput.safeParse({ ...input, lines: [...input.lines, ...input.lines] })
        .success,
    ).toBe(false);
  });
  it("fails closed for wrong environment keys and missing webhook identity", () => {
    const env = {
      APP_ENV: "staging",
      DD_CHECKOUT_ENABLED: "true",
      AUTH_URL: "https://example.test",
      DD_STRIPE_ACCOUNT_ID: "acct_synthetic",
      STRIPE_RESTRICTED_KEY: "rk_test_synthetic",
      STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
    };
    expect(commerceConfiguration(env).enabled).toBe(true);
    expect(
      commerceConfiguration({ ...env, STRIPE_RESTRICTED_KEY: "rk_live_synthetic" })
        .enabled,
    ).toBe(false);
    expect(commerceConfiguration({ ...env, STRIPE_WEBHOOK_SECRET: "" }).enabled).toBe(
      false,
    );
    expect(
      commerceConfiguration({
        ...env,
        APP_ENV: "production",
        STRIPE_RESTRICTED_KEY: "rk_live_synthetic",
      }).enabled,
    ).toBe(false);
  });
});

it("checkout kill switch leaves verified payment recovery available", () => {
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("DD_CHECKOUT_ENABLED", "false");
  vi.stubEnv("AUTH_URL", "https://example.test");
  vi.stubEnv("DD_STRIPE_ACCOUNT_ID", "acct_synthetic");
  vi.stubEnv("STRIPE_RESTRICTED_KEY", "rk_test_synthetic");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_synthetic");
  try {
    expect(() => requireCommerce()).toThrow();
    expect(() => requireCommerce(true)).not.toThrow();
  } finally {
    vi.unstubAllEnvs();
  }
});
