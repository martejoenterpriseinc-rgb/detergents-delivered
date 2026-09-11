import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), request: vi.fn(), confirm: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/services/email-verification", () => ({
  requestEmailVerification: mocks.request,
  confirmEmailVerification: mocks.confirm,
}));
import { POST } from "./route";
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dd.example.test/api/account/email-verification", {
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
  mocks.auth.mockResolvedValue({ user: { id: "current-user" } });
  mocks.request.mockResolvedValue({ verified: false });
  mocks.confirm.mockResolvedValue({ verified: true });
});
afterEach(() => vi.unstubAllEnvs());
describe("email verification HTTP boundary", () => {
  it("requires a current session, completed credentials, origin and JSON", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request({ action: "request" }))).status).toBe(401);
    mocks.auth.mockResolvedValue({
      user: { id: "current-user", mustChangeCredentials: true },
    });
    expect((await POST(request({ action: "request" }))).status).toBe(403);
    mocks.auth.mockResolvedValue({ user: { id: "current-user" } });
    expect(
      (await POST(request({ action: "request" }, { origin: "https://other.example" })))
        .status,
    ).toBe(403);
    expect(
      (await POST(request({ action: "request" }, { "content-type": "text/plain" })))
        .status,
    ).toBe(415);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("rejects caller-selected recipients, accounts, roles, unknown actions and oversized bodies", async () => {
    for (const extra of [
      { email: "other@example.test" },
      { userId: "other" },
      { roles: ["SUPER_ADMIN"] },
    ])
      expect((await POST(request({ action: "request", ...extra }))).status).toBe(400);
    expect((await POST(request({ action: "grantOwner" }))).status).toBe(400);
    expect(
      (await POST(request({ action: "confirm", token: "x".repeat(16000) }))).status,
    ).toBe(413);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("uses only session identity and keeps responses private and token-free", async () => {
    const response = await POST(request({ action: "request" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.request).toHaveBeenCalledWith("current-user");
    const token = "a".repeat(64);
    const confirmed = await POST(request({ action: "confirm", token }));
    expect(confirmed.status).toBe(200);
    expect(mocks.confirm).toHaveBeenCalledWith("current-user", { token });
    expect(await confirmed.text()).not.toContain(token);
  });
});
