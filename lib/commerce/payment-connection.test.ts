import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn(), account: vi.fn(), balance: vi.fn() }));
vi.mock("./runtime", () => ({ runtimeCommerceConfiguration: mocks.config }));
vi.mock("stripe", () => ({
  default: class {
    accounts = { retrieve: mocks.account };
    balance = { retrieve: mocks.balance };
  },
}));
import { paymentConnection } from "./payment-connection";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({
    key: "sk_test_synthetic",
    accountId: "acct_synthetic",
    live: false,
  });
  mocks.account.mockResolvedValue({ id: "acct_synthetic" });
  mocks.balance.mockResolvedValue({
    livemode: false,
    available: [
      { currency: "usd", amount: 1250 },
      { currency: "eur", amount: 999 },
    ],
    pending: [{ currency: "usd", amount: 250 }],
  });
});
it("confirms actual account and mode while separating USD balances", async () => {
  expect(await paymentConnection()).toMatchObject({
    connected: true,
    availableCents: 1250,
    pendingCents: 250,
  });
});
it("never calls Stripe with missing or wrong-mode credentials", async () => {
  mocks.config.mockResolvedValue({
    key: "sk_live_synthetic",
    accountId: "acct_synthetic",
    live: false,
  });
  expect((await paymentConnection()).connected).toBe(false);
  expect(mocks.account).not.toHaveBeenCalled();
});
it("reports account/mode mismatch and outages as disconnected without exposing provider errors", async () => {
  mocks.account.mockResolvedValue({ id: "acct_other" });
  expect((await paymentConnection()).connected).toBe(false);
  mocks.account.mockRejectedValue(Error("secret-provider-error"));
  const result = await paymentConnection();
  expect(result.connected).toBe(false);
  expect(JSON.stringify(result)).not.toContain("secret-provider-error");
});
it("rejects configuration changing during the read", async () => {
  mocks.config
    .mockResolvedValueOnce({
      key: "sk_test_synthetic",
      accountId: "acct_synthetic",
      live: false,
    })
    .mockResolvedValue({ key: "sk_test_changed", accountId: "acct_other", live: false });
  expect((await paymentConnection()).connected).toBe(false);
});
