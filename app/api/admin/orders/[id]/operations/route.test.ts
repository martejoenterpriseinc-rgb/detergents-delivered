import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  receive: vi.fn(),
  cancel: vi.fn(),
  prepare: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/services/refunds", () => ({
  recordStockReturn: mocks.receive,
  cancelPreparedRefund: mocks.cancel,
  prepareRewardOnlyRefund: mocks.prepare,
  settleRewardOnlyRefund: mocks.restore,
}));
import { POST } from "./route";
const input = {
  action: "receiveReturn",
  confirmed: true,
  data: {
    orderId: "order",
    requestKey: "b6c77593-5cbf-4755-82fd-4e612844f238",
    reason: "Unopened goods received at the warehouse",
    lines: [{ orderItemId: "item", quantity: 1, condition: "SELLABLE" }],
  },
};
const context = { params: Promise.resolve({ id: "order" }) };
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dd.example.test/api/admin/orders/order/operations", {
    method: "POST",
    headers: {
      origin: "https://dd.example.test",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", "https://dd.example.test");
  mocks.auth.mockResolvedValue({ user: { id: "staff" } });
  mocks.receive.mockResolvedValue({ id: "receipt" });
  mocks.cancel.mockResolvedValue({ id: "draft" });
});
afterEach(() => vi.unstubAllEnvs());
describe("order return operation boundary", () => {
  it("requires authentication, permitted origin, JSON and explicit goods receipt", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request(input), context)).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: "staff", mustChangeCredentials: true } });
    expect((await POST(request(input), context)).status).toBe(403);
    mocks.auth.mockResolvedValue({ user: { id: "staff" } });
    expect(
      (await POST(request(input, { origin: "https://other.example" }), context)).status,
    ).toBe(403);
    expect(
      (await POST(request(input, { "content-type": "text/plain" }), context)).status,
    ).toBe(415);
    expect((await POST(request({ ...input, confirmed: false }), context)).status).toBe(
      400,
    );
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it("rejects mismatched orders, unknown actions and oversized input", async () => {
    expect(
      (
        await POST(
          request({ ...input, data: { ...input.data, orderId: "other" } }),
          context,
        )
      ).status,
    ).toBe(409);
    expect(
      (await POST(request({ ...input, action: "issuePaymentRefund" }), context)).status,
    ).toBe(400);
    expect(
      (await POST(request({ ...input, extra: "x".repeat(16000) }), context)).status,
    ).toBe(413);
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it("requires explicit credit confirmation and rejects client supplied amounts", async () => {
    const data = { orderId: "order", requestId: "draft" };
    expect(
      (await POST(request({ action: "restoreRewardRefund", data }), context)).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            action: "restoreRewardRefund",
            confirmed: true,
            data: { ...data, amountCents: 999 },
          }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(mocks.restore).not.toHaveBeenCalled();
    mocks.restore.mockResolvedValue({ id: "draft", status: "SUCCEEDED" });
    expect(
      (
        await POST(
          request({ action: "restoreRewardRefund", confirmed: true, data }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(mocks.restore).toHaveBeenCalledWith("staff", data);
  });
  it("calls the staff service with a bounded order payload and private response", async () => {
    const response = await POST(request(input), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.receive).toHaveBeenCalledWith("staff", input.data);
    const data = {
      orderId: "order",
      requestId: "draft",
      reason: "Unused draft is no longer required",
    };
    expect(
      (await POST(request({ action: "cancelRefundDraft", data }), context)).status,
    ).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith("staff", data);
  });
});
