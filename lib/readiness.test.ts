import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/runtime-config", () => ({ validateRuntimeConfig: mocks.config }));
import { GET } from "@/app/api/ready/route";
describe("readiness HTTP response (mocked database)", () => {
  beforeEach(() => {
    mocks.transaction.mockReset();
    mocks.config.mockReset();
  });
  it("returns no-store success only after the database probe", async () => {
    mocks.transaction.mockResolvedValue(undefined);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).ok).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it("returns 503 without leaking database errors", async () => {
    mocks.transaction.mockRejectedValue(new Error("postgresql://private:secret@host/db"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, service: "detergents-delivered" });
  });
  it("rejects missing configuration before querying the database", async () => {
    mocks.config.mockImplementation(() => {
      throw new Error("missing");
    });
    expect((await GET()).status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
