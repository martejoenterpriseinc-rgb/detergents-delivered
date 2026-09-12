import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DeliveryTip } from "@prisma/client";
const m = vi.hoisted(() => ({
  config: vi.fn(),
  setup: vi.fn(),
  client: vi.fn(),
  customer: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
  account: vi.fn(),
}));
vi.mock("./runtime", () => ({ readCommerce: m.config }));
vi.mock("./stripe", () => ({ stripeClient: m.client, verifyStripeSetup: m.setup }));
import { createTipSession, retrieveTipSession, tipConfiguration } from "./tip-provider";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DD_TIPS_ENABLED", "true");
  vi.stubEnv("DD_TIP_TAX_CODE", "txcd_00000000");
  const stripe = {
    customers: { create: m.customer },
    checkout: { sessions: { create: m.create, retrieve: m.retrieve } },
    accounts: { retrieve: m.account },
  };
  m.config.mockResolvedValue({
    accountId: "acct_tip",
    live: false,
    origin: "https://example.test",
  });
  m.setup.mockResolvedValue(stripe);
  m.client.mockResolvedValue(stripe);
  m.account.mockResolvedValue({ id: "acct_tip" });
  m.customer.mockResolvedValue({ id: "cus_tip" });
  m.create.mockResolvedValue({ id: "cs_tip" });
});
afterEach(() => vi.unstubAllEnvs());
const tip = () =>
  ({
    id: "tip",
    orderId: "order",
    amountCents: 500,
    stripeAccountId: "acct_tip",
    livemode: false,
    taxCode: "txcd_00000000",
    expiresAt: new Date(Date.now() + 60 * 60000),
    source: {
      email: "tip@example.test",
      name: "Synthetic",
      address: {
        line1: "1 Original St",
        line2: "",
        city: "Synthetic",
        region: "IL",
        postalCode: "60000",
        country: "US",
      },
    },
  }) as unknown as DeliveryTip;
it("pins the original address and tax code, isolates the tip and reuses exact provider idempotency keys", async () => {
  const t = tip();
  await createTipSession(t);
  await createTipSession(t);
  expect(m.customer.mock.calls[0][0].shipping.address.line1).toBe("1 Original St");
  expect(m.customer.mock.calls[0][1]).toEqual({
    idempotencyKey: "dd:tip:tip:customer:v1",
  });
  expect(m.create.mock.calls[0][1]).toEqual({ idempotencyKey: "dd:tip:tip:session:v1" });
  expect(m.create.mock.calls[1]).toEqual(m.create.mock.calls[0]);
  expect(m.create.mock.calls[0][0]).toMatchObject({
    automatic_tax: { enabled: true },
    payment_method_types: ["card"],
    customer: "cus_tip",
    metadata: { tipId: "tip" },
    line_items: [
      {
        quantity: 1,
        price_data: {
          unit_amount: 500,
          tax_behavior: "exclusive",
          product_data: { tax_code: "txcd_00000000" },
        },
      },
    ],
  });
});
it("does not re-create an uncertain checkout outside the bounded retry window or after account/tax changes", async () => {
  await expect(
    createTipSession({ ...tip(), expiresAt: new Date(Date.now() + 29 * 60000) }),
  ).rejects.toThrow(/reconciliation/);
  await expect(
    createTipSession({ ...tip(), stripeAccountId: "acct_other" }),
  ).rejects.toThrow(/account/);
  await expect(createTipSession({ ...tip(), taxCode: "txcd_11111111" })).rejects.toThrow(
    /reconciliation/,
  );
  expect(m.create).not.toHaveBeenCalled();
  expect(m.customer).not.toHaveBeenCalled();
});
it("requires explicit activation and separate live-tip acceptance while permitting read-only recovery", async () => {
  vi.stubEnv("DD_TIPS_ENABLED", "false");
  await expect(tipConfiguration()).rejects.toThrow(/not available/);
  await expect(tipConfiguration(true)).resolves.toMatchObject({ live: false });
  vi.stubEnv("DD_TIPS_ENABLED", "true");
  m.config.mockResolvedValue({ accountId: "acct_tip", live: true });
  vi.stubEnv("DD_LIVE_TIPS_ACCEPTED", "false");
  await expect(tipConfiguration()).rejects.toThrow(/not available/);
});
it("checks provider account identity on recovery and never creates another payment", async () => {
  await retrieveTipSession(tip(), "cs_tip");
  expect(m.retrieve).toHaveBeenCalledWith("cs_tip", {
    expand: ["line_items.data.price.product", "payment_intent"],
  });
  m.account.mockResolvedValue({ id: "acct_other" });
  await expect(retrieveTipSession(tip(), "cs_tip")).rejects.toThrow(/identity/);
  expect(m.create).not.toHaveBeenCalled();
});
