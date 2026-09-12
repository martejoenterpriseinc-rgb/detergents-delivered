import { beforeEach, expect, it, vi } from "vitest";
import type { CheckoutAttempt, ManualCheckoutSettlement } from "@prisma/client";
const m = vi.hoisted(() => ({
  config: vi.fn(),
  setup: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
}));
vi.mock("./runtime", () => ({ readCommerce: m.config }));
vi.mock("./stripe", () => ({ verifyStripeSetup: m.setup }));
import { confirmManualTax } from "./manual-tax";
const receivedAt = new Date("2026-09-12T12:00:00Z");
const a = {
  id: "checkout_synthetic",
  stripeAccountId: "acct_synthetic",
  livemode: false,
  snapshot: {
    taxCalculationId: "taxcalc_synthetic",
    taxCents: 8,
    lines: [{ variantId: "variant", netCents: 100, taxCode: "txcd_synthetic" }],
    address: {
      country: "US",
      region: "IL",
      postalCode: "60000",
      line1: "1 Synthetic Lane",
      line2: "",
      city: "Synthetic",
    },
  },
} as unknown as CheckoutAttempt;
const receipt = () =>
  ({
    id: "manual_synthetic",
    accountId: "acct_synthetic",
    livemode: false,
    submittedAt: new Date(),
    receivedAt,
    amountCents: 108,
    taxTransactionId: null,
  }) as ManualCheckoutSettlement;
const transaction = () => ({
  id: "tax_synthetic",
  type: "transaction",
  reversal: null,
  reference: "dd-manual:manual_synthetic",
  metadata: {
    project: "detergents-delivered",
    checkoutId: a.id,
    manualSettlementId: "manual_synthetic",
  },
  livemode: false,
  currency: "usd",
  posted_at: Math.floor(receivedAt.getTime() / 1000),
  customer_details: {
    address: {
      country: "US",
      state: "IL",
      postal_code: "60000",
      line1: "1 Synthetic Lane",
      line2: "",
      city: "Synthetic",
    },
  },
  line_items: {
    has_more: false,
    data: [
      {
        reference: "variant",
        livemode: false,
        type: "transaction",
        reversal: null,
        quantity: 1,
        tax_behavior: "exclusive",
        tax_code: "txcd_synthetic",
        amount: 100,
        amount_tax: 8,
      },
    ],
  },
  shipping_cost: null,
});
beforeEach(() => {
  vi.resetAllMocks();
  m.config.mockResolvedValue({ accountId: "acct_synthetic", live: false });
  m.setup.mockResolvedValue({
    tax: { transactions: { createFromCalculation: m.create, retrieve: m.get } },
  });
  m.create.mockResolvedValue(transaction());
  m.get.mockResolvedValue(transaction());
});
it("posts the existing calculation with a stable reference, receipt time and retry key", async () => {
  expect(await confirmManualTax(a, receipt())).toMatchObject({
    taxTransactionId: "tax_synthetic",
    taxLines: [{ variantId: "variant", netCents: 100, taxCents: 8 }],
  });
  expect(m.create).toHaveBeenCalledWith(
    expect.objectContaining({
      calculation: "taxcalc_synthetic",
      posted_at: Math.floor(receivedAt.getTime() / 1000),
    }),
    expect.objectContaining({
      idempotencyKey: "dd-manual:manual_synthetic",
      maxNetworkRetries: 0,
    }),
  );
});
it("retrieves a recovered transaction without reposting even after the safe retry period", async () => {
  const old = { ...receipt(), submittedAt: new Date(Date.now() - 24 * 3600000) };
  await expect(confirmManualTax(a, old)).rejects.toThrow();
  expect(m.create).not.toHaveBeenCalled();
  await confirmManualTax(a, old, "tax_synthetic");
  expect(m.get).toHaveBeenCalled();
  expect(m.create).not.toHaveBeenCalled();
});
it("rejects account changes before provider posting", async () => {
  m.config.mockResolvedValue({ accountId: "acct_other", live: false });
  await expect(confirmManualTax(a, receipt())).rejects.toThrow();
  expect(m.create).not.toHaveBeenCalled();
});
it("rejects mismatched totals, addresses, metadata, mode, duplicate lines and truncated evidence", async () => {
  const cases = [
    { ...transaction(), currency: "eur" },
    { ...transaction(), livemode: true },
    { ...transaction(), metadata: { project: "other" } },
    { ...transaction(), reference: "another-order" },
    {
      ...transaction(),
      customer_details: {
        address: {
          ...transaction().customer_details.address,
          line1: "Another destination",
        },
      },
    },
    { ...transaction(), line_items: { ...transaction().line_items, has_more: true } },
    {
      ...transaction(),
      line_items: {
        has_more: false,
        data: [...transaction().line_items.data, ...transaction().line_items.data],
      },
    },
    {
      ...transaction(),
      line_items: {
        has_more: false,
        data: [{ ...transaction().line_items.data[0], amount_tax: 9 }],
      },
    },
  ];
  for (const value of cases) {
    m.create.mockResolvedValue(value);
    await expect(confirmManualTax(a, receipt())).rejects.toThrow();
  }
});
