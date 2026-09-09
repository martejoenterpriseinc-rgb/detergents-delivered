import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiRole: mocks.gate }));
vi.mock("@/lib/services/integration-status", () => ({ integrationStatus: mocks.status }));
vi.mock("@/lib/account-api", () => ({
  accountJson: (value: unknown) =>
    Response.json(value, { headers: { "Cache-Control": "private, no-store" } }),
}));
import { GET } from "./route";
afterEach(() => vi.resetAllMocks());
it("checks administrator access before reading any provider configuration", async () => {
  for (const status of [401, 403]) {
    mocks.gate.mockResolvedValue({ error: new Response(null, { status }) });
    expect((await GET()).status).toBe(status);
    expect(mocks.status).not.toHaveBeenCalled();
  }
  expect(mocks.gate).toHaveBeenCalledWith(["ADMIN", "SUPER_ADMIN"]);
});
it("returns uncached configuration status only for permitted administrators", async () => {
  mocks.gate.mockResolvedValue({ session: { user: { id: "synthetic-admin" } } });
  mocks.status.mockReturnValue({ environment: "staging", connections: [] });
  const response = await GET();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ environment: "staging", connections: [] });
});
