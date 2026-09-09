import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ constructEvent: vi.fn(), findUnique: vi.fn() }));
vi.mock("@/lib/commerce/stripe", () => ({
  stripeClient: () => ({ webhooks: { constructEvent: mocks.constructEvent } }),
}));
vi.mock("@/lib/commerce/checkout", () => ({ reconcileCheckout: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { checkoutAttempt: { findUnique: mocks.findUnique } },
}));
import { POST } from "./route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
function setup() {
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("AUTH_URL", "https://sandbox.example.com");
  vi.stubEnv("DD_SANDBOX_STRIPE_RESTRICTED_KEY", "rk_test_synthetic");
  vi.stubEnv("DD_SANDBOX_STRIPE_ACCOUNT_ID", "acct_synthetic");
  vi.stubEnv("DD_SANDBOX_STRIPE_WEBHOOK_SECRET", "whsec_sandbox_specific");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_unused_legacy");
  // Recovery continues while checkout is closed.
  vi.stubEnv("DD_CHECKOUT_ENABLED", "false");
}
const request = () =>
  new Request("https://sandbox.example.com/api/stripe/webhook?environment=live", {
    method: "POST",
    headers: {
      "stripe-signature": "synthetic-signature",
      "x-environment": "live",
      cookie: "environment=live",
    },
    body: "synthetic-event",
  });
describe("webhook environment authority", () => {
  it("ignores browser environment inputs and verifies with the sandbox signing secret", async () => {
    setup();
    mocks.constructEvent.mockReturnValue({ livemode: false, type: "unhandled.event" });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.constructEvent).toHaveBeenCalledWith(
      Buffer.from("synthetic-event"),
      "synthetic-signature",
      "whsec_sandbox_specific",
    );
  });
  it.each([{ livemode: true }, { livemode: false, account: "acct_other" }])(
    "rejects wrong-mode or wrong-account events before database access",
    async (event) => {
      setup();
      mocks.constructEvent.mockReturnValue({
        type: "checkout.session.completed",
        ...event,
      });
      expect((await POST(request())).status).toBe(400);
      expect(mocks.findUnique).not.toHaveBeenCalled();
    },
  );
  it("does not fall back to the legacy signing secret", async () => {
    setup();
    vi.stubEnv("DD_SANDBOX_STRIPE_WEBHOOK_SECRET", "");
    expect((await POST(request())).status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });
});
