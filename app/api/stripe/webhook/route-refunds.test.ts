import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  verify: vi.fn(),
  tipRefund: vi.fn(),
  tip: vi.fn(),
  checkout: vi.fn(),
}));
vi.mock("@/lib/commerce/stripe", () => ({
  stripeClient: async () => ({ webhooks: { constructEvent: m.verify } }),
}));
vi.mock("@/lib/commerce/runtime", () => ({
  readCommerce: async () => ({
    accountId: "acct_test",
    live: false,
    webhookSecret: "test",
  }),
}));
vi.mock("@/lib/services/tip-refunds", () => ({ reconcileTipRefundEvent: m.tipRefund }));
vi.mock("@/lib/services/delivery-tips", () => ({ reconcileDeliveryTip: m.tip }));
vi.mock("@/lib/commerce/checkout", () => ({ reconcileCheckout: m.checkout }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { POST } from "./route";
const refund = { object: "refund", id: "re_test" };
const request = (signature = true, body = "{}") =>
  new Request("https://example.test/api/stripe/webhook", {
    method: "POST",
    body,
    headers: signature ? { "stripe-signature": "test" } : {},
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.verify.mockReturnValue({
    type: "refund.updated",
    livemode: false,
    data: { object: refund },
  });
});
it.each(["refund.created", "refund.updated", "refund.failed"])(
  "routes %s only to tip refund reconciliation",
  async (type) => {
    m.verify.mockReturnValue({ type, livemode: false, data: { object: refund } });
    expect((await POST(request())).status).toBe(200);
    expect(m.tipRefund).toHaveBeenCalledWith(
      refund,
      expect.objectContaining({ accountId: "acct_test", live: false }),
    );
    expect(m.checkout).not.toHaveBeenCalled();
    expect(m.tip).not.toHaveBeenCalled();
  },
);
it("rejects missing/bad signatures and wrong account or environment before any reconciliation", async () => {
  expect((await POST(request(false))).status).toBe(400);
  m.verify.mockImplementationOnce(() => {
    throw Error("bad signature");
  });
  expect((await POST(request())).status).toBe(400);
  for (const mismatch of [{ livemode: true }, { account: "acct_other" }]) {
    m.verify.mockReturnValue({
      type: "refund.failed",
      livemode: false,
      data: { object: refund },
      ...mismatch,
    });
    expect((await POST(request())).status).toBe(400);
  }
  expect(m.tipRefund).not.toHaveBeenCalled();
});
it("asks Stripe to retry uncertain evidence and accepts a later successful lookup", async () => {
  m.tipRefund.mockRejectedValueOnce(Error("provider unavailable"));
  expect((await POST(request())).status).toBe(503);
  expect((await POST(request())).status).toBe(200);
});
it("rejects oversized bodies before signature parsing or reconciliation", async () => {
  expect((await POST(request(true, "x".repeat(1024 * 1024 + 1)))).status).toBe(413);
  expect(m.verify).not.toHaveBeenCalled();
  expect(m.tipRefund).not.toHaveBeenCalled();
});
