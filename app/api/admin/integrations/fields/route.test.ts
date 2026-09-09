import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  auth: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/api-auth", () => ({ requireApiRole: mocks.gate }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/integrations/vault", () => ({
  apiEditorData: mocks.read,
  saveApiField: mocks.save,
}));
import { GET, PATCH } from "./route";
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
function setup() {
  vi.stubEnv("AUTH_URL", "https://sandbox.example.com");
  mocks.gate.mockResolvedValue({ session: { user: { id: "owner" } } });
  mocks.auth.mockResolvedValue({ user: { id: "owner" } });
}
const request = (
  origin = "https://sandbox.example.com",
  body = JSON.stringify({
    environment: "sandbox",
    provider: "google",
    field: "GOOGLE_CLIENT_SECRET",
    value: "never-echo-this",
    version: 0,
  }),
) =>
  new Request("https://sandbox.example.com/api/admin/integrations/fields", {
    method: "PATCH",
    headers: { origin, "content-type": "application/json" },
    body,
  });
it("rejects visitors and staff before reading or saving any credential", async () => {
  for (const status of [401, 403]) {
    mocks.gate.mockResolvedValue({ error: new Response(null, { status }) });
    expect((await GET()).status).toBe(status);
    expect((await PATCH(request())).status).toBe(status);
  }
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects cross-origin and oversized writes and never returns submitted secrets", async () => {
  setup();
  expect((await PATCH(request("https://attacker.example.com"))).status).toBe(403);
  expect(
    (await PATCH(request("https://sandbox.example.com", "a".repeat(16001)))).status,
  ).toBe(413);
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.save.mockResolvedValue({ active: "sandbox", groups: [] });
  const response = await PATCH(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).not.toContain("never-echo-this");
  expect(mocks.save).toHaveBeenCalledWith(
    "owner",
    expect.objectContaining({ field: "GOOGLE_CLIENT_SECRET" }),
  );
});
