import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  manualTaxReversalPayload,
  verifyManualTaxReversal,
  executeManualTaxReversal,
  type ManualTaxReversalBinding,
} from "./manual-refund-tax";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  retrieve: vi.fn(),
  create: vi.fn(),
  account: vi.fn(),
}));
vi.mock("./runtime", () => ({ readCommerce: mocks.config }));
vi.mock("./stripe", () => ({
  stripeClient: async () => ({
    accounts: { retrieve: mocks.account },
    tax: { transactions: { retrieve: mocks.retrieve, createReversal: mocks.create } },
  }),
}));
const binding: ManualTaxReversalBinding = {
  requestId: "refund",
  requestHash: "a".repeat(64),
  checkoutId: "checkout",
  settlementId: "settlement",
  accountId: "acct_test",
  live: false,
  originalTransactionId: "tax_original",
  receivedAt: "2026-02-01T18:00:00Z",
  address: {
    line1: "1 Test",
    line2: "",
    city: "Test",
    region: "IL",
    postalCode: "60000",
    country: "US",
  },
  saleLines: [
    { variantId: "variant", netCents: 2100, taxCents: 168, taxCode: "txcd_test" },
  ],
  refundLines: [
    {
      orderItemId: "item",
      variantId: "variant",
      netCents: 700,
      taxCents: 56,
      quantity: 1,
    },
  ],
};
const original = () =>
  ({
    id: "tax_original",
    object: "tax.transaction",
    currency: "usd",
    livemode: false,
    type: "transaction",
    reversal: null,
    reference: "dd-manual:settlement",
    metadata: {
      project: "detergents-delivered",
      checkoutId: "checkout",
      manualSettlementId: "settlement",
    },
    posted_at: Date.parse(binding.receivedAt) / 1000,
    customer_details: {
      address: {
        line1: "1 Test",
        line2: null,
        city: "Test",
        state: "IL",
        postal_code: "60000",
        country: "US",
      },
    },
    shipping_cost: null,
    line_items: {
      has_more: false,
      data: [
        {
          id: "tax_li_original",
          reference: "variant",
          amount: 2100,
          amount_tax: 168,
          livemode: false,
          type: "transaction",
          reversal: null,
          quantity: 1,
          tax_behavior: "exclusive",
          tax_code: "txcd_test",
        },
      ],
    },
  }) as unknown as Stripe.Tax.Transaction;
const reversed = () =>
  ({
    ...original(),
    id: "tax_reversed",
    type: "reversal",
    reversal: { original_transaction: "tax_original" },
    reference: "dd-manual-refund:refund",
    metadata: {
      project: "detergents-delivered",
      manualRefundRequestId: "refund",
      requestHash: binding.requestHash,
    },
    line_items: {
      has_more: false,
      data: [
        {
          ...original().line_items!.data[0],
          id: "tax_li_reverse",
          reference: "item",
          amount: -700,
          amount_tax: -56,
          type: "reversal",
          reversal: { original_line_item: "tax_li_original" },
        },
      ],
    },
  }) as unknown as Stripe.Tax.Transaction;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({
    accountId: "acct_test",
    live: false,
    key: "synthetic",
  });
  mocks.account.mockResolvedValue({ id: "acct_test" });
  mocks.retrieve.mockImplementation(async (id) =>
    id === "tax_original" ? original() : reversed(),
  );
  mocks.create.mockResolvedValue(reversed());
});
it("binds exact partial net and tax amounts to the original transaction lines", () => {
  const p = manualTaxReversalPayload(binding, original());
  expect(p.line_items).toEqual([
    {
      amount: -700,
      amount_tax: -56,
      original_line_item: "tax_li_original",
      reference: "item",
      quantity: 1,
    },
  ]);
  expect(verifyManualTaxReversal(binding, p, reversed())).toMatchObject({
    originalTaxTransactionId: "tax_original",
    refundTaxTransactionId: "tax_reversed",
    taxLines: [{ orderItemId: "item", netCents: 700, taxCents: 56 }],
  });
});
it("rejects mismatched originals, partial line lists and wrong reversal amounts", () => {
  expect(() =>
    manualTaxReversalPayload(binding, { ...original(), reference: "another receipt" }),
  ).toThrow();
  expect(() =>
    manualTaxReversalPayload(binding, {
      ...original(),
      line_items: { ...original().line_items!, has_more: true },
    }),
  ).toThrow();
  const p = manualTaxReversalPayload(binding, original()),
    r = reversed();
  r.line_items!.data[0].amount_tax = -55;
  expect(() => verifyManualTaxReversal(binding, p, r)).toThrow();
  expect(() =>
    verifyManualTaxReversal(binding, p, { ...reversed(), livemode: true }),
  ).toThrow();
});
it("creates once with a stable key, while recovery only retrieves", async () => {
  await executeManualTaxReversal(binding, undefined, async () => {});
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][1]).toMatchObject({
    idempotencyKey: "dd-manual-refund:refund",
    maxNetworkRetries: 0,
  });
  await executeManualTaxReversal(binding, "tax_reversed");
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("refuses account or configuration changes before creating a reversal", async () => {
  mocks.account.mockResolvedValue({ id: "acct_wrong" });
  await expect(executeManualTaxReversal(binding)).rejects.toThrow();
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.account.mockResolvedValue({ id: "acct_test" });
  mocks.config
    .mockResolvedValueOnce({ accountId: "acct_test", live: false, key: "old" })
    .mockResolvedValueOnce({ accountId: "acct_test", live: false, key: "new" });
  await expect(executeManualTaxReversal(binding)).rejects.toThrow();
  expect(mocks.create).not.toHaveBeenCalled();
});

it("requires current staff authorization after provider reads and before tax creation", async () => {
  await expect(executeManualTaxReversal(binding)).rejects.toThrow();
  expect(mocks.create).not.toHaveBeenCalled();
  const authorize = vi.fn().mockRejectedValue(new Error("Synthetic revoked permission"));
  await expect(executeManualTaxReversal(binding, undefined, authorize)).rejects.toThrow();
  expect(authorize).toHaveBeenCalledOnce();
  expect(mocks.retrieve).toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
