import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  account: vi.fn(),
  payment: vi.fn(),
  charge: vi.fn(),
  refunds: vi.fn(),
}));
vi.mock("./runtime", () => ({ readCommerce: mocks.config }));
vi.mock("./stripe", () => ({
  stripeClient: async () => ({
    accounts: { retrieve: mocks.account },
    paymentIntents: { retrieve: mocks.payment },
    charges: { retrieve: mocks.charge },
    refunds: { list: mocks.refunds },
  }),
}));
import {
  inspectStripeRefunds,
  matchProviderRefunds,
  type RefundPaymentObservation,
  type RefundObservation,
} from "./refund-provider";

const binding = {
  accountId: "acct_original",
  live: false,
  paymentIntentId: "pi_original",
  checkoutId: "checkout-original",
  amountCents: 1083,
  currency: "USD",
};
const payment = {
  id: binding.paymentIntentId,
  latest_charge: "ch_original",
  livemode: false,
  status: "succeeded",
  amount: 1083,
  amount_received: 1083,
  currency: "usd",
  metadata: { checkoutId: binding.checkoutId, project: "detergents-delivered" },
};
const charge = {
  id: "ch_original",
  payment_intent: binding.paymentIntentId,
  livemode: false,
  paid: true,
  captured: true,
  amount: 1083,
  amount_captured: 1083,
  currency: "usd",
  disputed: false,
};
const rawRefund = {
  id: "re_original",
  object: "refund",
  charge: "ch_original",
  payment_intent: binding.paymentIntentId,
  amount: 360,
  currency: "usd",
  status: "pending",
  created: 1780000000,
  metadata: {
    project: "detergents-delivered",
    refundRequestId: "request-1",
    requestHash: "hash-1",
    private: "omit-this",
  },
  balance_transaction: "txn_original",
  instructions_email: "private@example.test",
  next_action: { secret: "omit-this-too" },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({ accountId: binding.accountId, live: false });
  mocks.account.mockResolvedValue({ id: binding.accountId });
  mocks.payment.mockResolvedValue(payment);
  mocks.charge.mockResolvedValue(charge);
  mocks.refunds.mockResolvedValue({ data: [rawRefund], has_more: false });
});

describe("original Stripe refund evidence (mock provider)", () => {
  it("binds the original account, payment and charge and selects only necessary evidence", async () => {
    const result = await inspectStripeRefunds(binding);
    expect(result).toMatchObject({
      accountId: binding.accountId,
      paymentIntentId: binding.paymentIntentId,
      currency: binding.currency,
      live: binding.live,
      chargeId: "ch_original",
      capturedCents: 1083,
      refunds: [
        {
          id: "re_original",
          amountCents: 360,
          status: "pending",
          requestId: "request-1",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(JSON.stringify(result)).not.toContain("omit-this");
    expect(JSON.stringify(result)).not.toContain("next_action");
    expect(mocks.refunds).toHaveBeenCalledWith(
      { payment_intent: "pi_original", limit: 100 },
      { timeout: 8000, maxNetworkRetries: 0 },
    );
  });
  it("rejects wrong account and mode before provider reads", async () => {
    mocks.config.mockResolvedValue({ accountId: "acct_wrong", live: false });
    await expect(inspectStripeRefunds(binding)).rejects.toMatchObject({ status: 409 });
    mocks.config.mockResolvedValue({ accountId: binding.accountId, live: true });
    await expect(inspectStripeRefunds(binding)).rejects.toMatchObject({ status: 409 });
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it("rejects provider account identity and original payment mismatches", async () => {
    mocks.account.mockResolvedValue({ id: "acct_other" });
    await expect(inspectStripeRefunds(binding)).rejects.toMatchObject({ status: 409 });
    mocks.account.mockResolvedValue({ id: binding.accountId });
    for (const patch of [
      { id: "pi_other" },
      { amount: 1084 },
      { amount_received: 0 },
      { currency: "eur" },
      { livemode: true },
      { status: "processing" },
      { metadata: { ...payment.metadata, checkoutId: "another" } },
      { latest_charge: null },
    ]) {
      mocks.payment.mockResolvedValue({ ...payment, ...patch });
      await expect(inspectStripeRefunds(binding)).rejects.toMatchObject({ status: 409 });
    }
    expect(mocks.refunds).not.toHaveBeenCalled();
  });
  it("rejects missing capture and charge identity mismatches", async () => {
    for (const patch of [
      { id: "ch_other" },
      { payment_intent: "pi_other" },
      { amount_captured: 0 },
      { currency: "eur" },
      { livemode: true },
      { captured: false },
      { paid: false },
    ]) {
      mocks.charge.mockResolvedValue({ ...charge, ...patch });
      await expect(inspectStripeRefunds(binding)).rejects.toMatchObject({ status: 409 });
    }
    expect(mocks.refunds).not.toHaveBeenCalled();
  });
  it("reads every page and rejects duplicate or truncated history", async () => {
    mocks.refunds
      .mockResolvedValueOnce({ data: [rawRefund], has_more: true })
      .mockResolvedValueOnce({
        data: [{ ...rawRefund, id: "re_second" }],
        has_more: false,
      });
    expect((await inspectStripeRefunds(binding)).refunds).toHaveLength(2);
    expect(mocks.refunds).toHaveBeenLastCalledWith(
      { payment_intent: "pi_original", limit: 100, starting_after: "re_original" },
      expect.anything(),
    );
    mocks.refunds.mockResolvedValue({ data: [rawRefund], has_more: true });
    await expect(inspectStripeRefunds(binding)).rejects.toMatchObject({ status: 409 });
    mocks.refunds.mockResolvedValue({ data: [], has_more: true });
    await expect(inspectStripeRefunds(binding)).rejects.toMatchObject({ status: 409 });
    let index = 0;
    mocks.refunds.mockImplementation(async () => ({
      data: [{ ...rawRefund, id: `re_page${index++}` }],
      has_more: true,
    }));
    await expect(inspectStripeRefunds(binding)).rejects.toMatchObject({ status: 409 });
    expect(index).toBe(5);
  });
  it("rejects cross-payment refunds, unknown states and invalid amounts", async () => {
    for (const patch of [
      { payment_intent: "pi_other" },
      { charge: "ch_other" },
      { status: "future_state" },
      { currency: "eur" },
      { amount: 0 },
      { amount: 1084 },
      { amount: 0.1 },
    ]) {
      mocks.refunds.mockResolvedValue({
        data: [{ ...rawRefund, ...patch }],
        has_more: false,
      });
      await expect(inspectStripeRefunds(binding)).rejects.toMatchObject({ status: 409 });
    }
  });
});

const refund: RefundObservation = {
  id: "re_original",
  amountCents: 360,
  currency: "USD",
  status: "pending",
  created: 1780000000,
  requestId: "request-1",
  requestHash: "hash-1",
  project: "detergents-delivered",
  balanceTransactionId: null,
  failureBalanceTransactionId: null,
};
const observation: RefundPaymentObservation = {
  paymentIntentId: "pi_original",
  chargeId: "ch_original",
  accountId: "acct_original",
  live: false,
  capturedCents: 1083,
  currency: "USD",
  disputed: false,
  refunds: [refund],
};
const expected = {
  id: "request-1",
  requestHash: "hash-1",
  providerRefundId: null,
  submitted: true,
  amountCents: 360,
  currency: "USD",
};
describe("refund reconciliation matching", () => {
  it("recovers an unknown create response only through exact saved metadata and amount", () => {
    const result = matchProviderRefunds(observation, [expected]);
    expect(result.matched.get(expected.id)).toEqual(refund);
    expect(result.reservedCents).toBe(360);
  });
  it("blocks external, duplicate, mismatched and disappearing provider refunds", () => {
    expect(() => matchProviderRefunds(observation, [])).toThrow();
    for (const patch of [
      { submitted: false },
      { amountCents: 361 },
      { requestHash: "different" },
      { currency: "EUR" },
    ])
      expect(() =>
        matchProviderRefunds(observation, [{ ...expected, ...patch }]),
      ).toThrow();
    expect(() =>
      matchProviderRefunds(
        { ...observation, refunds: [refund, { ...refund, id: "re_duplicate" }] },
        [expected],
      ),
    ).toThrow();
    expect(() =>
      matchProviderRefunds({ ...observation, refunds: [] }, [
        { ...expected, providerRefundId: refund.id },
      ]),
    ).toThrow();
    expect(() =>
      matchProviderRefunds({ ...observation, capturedCents: 359 }, [expected]),
    ).toThrow();
  });
  it("keeps pending and action-required amounts reserved and releases only verified failures/cancellations", () => {
    for (const status of [
      "pending",
      "requires_action",
      "succeeded",
      "failed",
      "canceled",
    ] as const) {
      const result = matchProviderRefunds(
        { ...observation, refunds: [{ ...refund, status }] },
        [expected],
      );
      expect(result.reservedCents).toBe(
        ["failed", "canceled"].includes(status) ? 0 : 360,
      );
    }
  });
});
