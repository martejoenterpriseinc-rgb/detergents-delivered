import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  access: vi.fn(),
  authorized: vi.fn(),
  assert: vi.fn(),
  verify: vi.fn(),
  config: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("./finance", () => ({ financeAccess: m.access }));
vi.mock("./quickbooks-connection", () => ({
  authorizedQuickbooks: m.authorized,
  assertQuickbooksSnapshot: m.assert,
}));
vi.mock("@/lib/integrations/quickbooks-client", () => ({
  quickbooksConfig: m.config,
  verifyQuickbooksCompany: m.verify,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
import { quickbooksHealth } from "./quickbooks-health";
beforeEach(() => {
  vi.resetAllMocks();
  const config = { fingerprint: "original", realm: "123", mode: "sandbox" };
  m.config.mockResolvedValue(config);
  m.authorized.mockResolvedValue({ config, accessToken: "synthetic-secret" });
  m.verify.mockResolvedValue("Synthetic company");
  m.transaction.mockImplementation((fn) => fn({}));
});
it("checks provider access and unchanged authorization before returning connected", async () => {
  expect(await quickbooksHealth("admin")).toMatchObject({ connected: true });
  expect(m.verify).toHaveBeenCalledOnce();
  expect(m.assert).toHaveBeenCalledOnce();
});
it("never exposes provider errors or claims a disconnected company is live", async () => {
  m.verify.mockRejectedValue(new Error("synthetic-secret"));
  const result = await quickbooksHealth("admin");
  expect(result.connected).toBe(false);
  expect(JSON.stringify(result)).not.toContain("synthetic-secret");
});
it("rejects configuration rotation and authorization revocation during a provider read", async () => {
  m.config.mockResolvedValue({ fingerprint: "changed" });
  expect((await quickbooksHealth("admin")).connected).toBe(false);
  m.config.mockResolvedValue({ fingerprint: "original" });
  m.assert.mockRejectedValue(new Error("disconnected"));
  expect((await quickbooksHealth("admin")).connected).toBe(false);
});
it("denies nonfinancial users before any provider activity", async () => {
  m.access.mockRejectedValue(new Error("forbidden"));
  await expect(quickbooksHealth("customer")).rejects.toThrow("forbidden");
  expect(m.authorized).not.toHaveBeenCalled();
  expect(m.verify).not.toHaveBeenCalled();
});
