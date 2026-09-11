import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  change: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/services/subscriptions", () => ({
  createSubscription: mocks.create,
  changeSubscription: mocks.change,
  readSubscriptions: mocks.read,
}));
import { GET, POST } from "./route";
const data = {
  requestKey: "7338d354-9c66-4683-8e04-3f0158357186",
  originOrderId: "order",
  accepted: true,
  consentVersion: "quarterly-pay-at-purchase-v1",
};
const request = (body: unknown, origin = "https://dd.example.test") =>
  new Request("https://dd.example.test/api/account/subscriptions", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", "https://dd.example.test");
  mocks.auth.mockResolvedValue({ user: { id: "household" } });
  mocks.create.mockResolvedValue({ id: "sub" });
  mocks.read.mockResolvedValue({ subscriptions: [] });
});
afterEach(() => vi.unstubAllEnvs());
describe("subscription HTTP boundaries", () => {
  it("requires authentication and same origin", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: "household" } });
    expect(
      (await POST(request({ kind: "create", data }, "https://other.example"))).status,
    ).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects cadence overrides, absent consent and oversized bodies", async () => {
    expect(
      (await POST(request({ kind: "create", data: { ...data, cadenceDays: 28 } })))
        .status,
    ).toBe(400);
    expect(
      (await POST(request({ kind: "create", data: { ...data, accepted: false } })))
        .status,
    ).toBe(400);
    expect((await POST(request({ extra: "x".repeat(16001) }))).status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("returns private household data through the authenticated service", async () => {
    const r = await POST(request({ kind: "create", data }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.create).toHaveBeenCalledWith("household", data);
  });
});
