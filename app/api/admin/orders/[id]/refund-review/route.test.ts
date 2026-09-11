import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), review: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/services/refund-review", async (original) => ({
  ...(await original<typeof import("@/lib/services/refund-review")>()),
  reviewPaymentRefunds: mocks.review,
}));
import { POST } from "./route";
const context = { params: Promise.resolve({ id: "order" }) };
const input = { orderId: "order", paymentId: "payment" };
function request(body: unknown, origin = "https://dd.example.test") {
  return new Request("https://dd.example.test/api/admin/orders/order/refund-review", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", "https://dd.example.test");
  mocks.auth.mockResolvedValue({ user: { id: "staff" } });
  mocks.review.mockResolvedValue({ providerRefundCount: 0 });
});
afterEach(() => vi.unstubAllEnvs());
describe("refund inspection request boundary", () => {
  it("rejects anonymous and cross-origin calls before provider access", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request(input), context)).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: "staff" } });
    expect((await POST(request(input, "https://other.example"), context)).status).toBe(
      403,
    );
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("rejects mismatched orders and extra mutation fields", async () => {
    expect((await POST(request({ ...input, orderId: "other" }), context)).status).toBe(
      409,
    );
    expect((await POST(request({ ...input, amountCents: 100 }), context)).status).toBe(
      400,
    );
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("returns private inspection data and hides raw provider errors", async () => {
    const response = await POST(request(input), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.review).toHaveBeenCalledWith("staff", input);
    mocks.review.mockRejectedValueOnce(new Error("private provider error"));
    const failed = await POST(request(input), context);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private provider error");
  });
});
