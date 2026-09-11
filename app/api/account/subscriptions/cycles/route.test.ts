import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), prepare: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/services/subscription-cycles", () => ({
  prepareSubscriptionCycle: mocks.prepare,
}));
import { POST } from "./route";
const request = (body: unknown, origin = "https://dd.example.test") =>
  new Request("https://dd.example.test/api/account/subscriptions/cycles", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", "https://dd.example.test");
  mocks.auth.mockResolvedValue({ user: { id: "household" } });
  mocks.prepare.mockResolvedValue({ id: "cycle" });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects anonymous, cross-origin, oversized and client-controlled quarter requests", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  expect((await POST(request({ subscriptionId: "sub" }))).status).toBe(401);
  expect(
    (await POST(request({ subscriptionId: "sub" }, "https://other.example"))).status,
  ).toBe(403);
  expect((await POST(request({ subscriptionId: "sub", cycleNumber: 99 }))).status).toBe(
    400,
  );
  expect((await POST(request({ extra: "x".repeat(16001) }))).status).toBe(413);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("passes only the authenticated household and subscription reference and returns private data", async () => {
  const r = await POST(request({ subscriptionId: "sub" }));
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.prepare).toHaveBeenCalledWith("household", { subscriptionId: "sub" });
  expect(await r.json()).toEqual({ id: "cycle" });
});
