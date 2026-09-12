import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  access: vi.fn(),
  authorized: vi.fn(),
  assert: vi.fn(),
  config: vi.fn(),
  company: vi.fn(),
  report: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: async (f: (tx: unknown) => unknown) => f({}) },
}));
vi.mock("./finance", () => ({ financeAccess: m.access }));
vi.mock("./quickbooks-connection", () => ({
  authorizedQuickbooks: m.authorized,
  assertQuickbooksSnapshot: m.assert,
}));
vi.mock("@/lib/integrations/quickbooks-client", () => ({
  quickbooksConfig: m.config,
  verifyQuickbooksCompany: m.company,
  readQuickbooksFinancialReportData: m.report,
}));
import { quickbooksFinancialReport } from "./quickbooks-financial-report";
const config = { fingerprint: "original", realm: "123", mode: "sandbox" };
beforeEach(() => {
  vi.resetAllMocks();
  m.authorized.mockResolvedValue({ config, accessToken: "never-return-token" });
  m.config.mockResolvedValue(config);
  m.company.mockResolvedValue("Synthetic company");
  m.report.mockImplementation(async (_c, _t, r) => ({
    Header: {
      ReportName: r.name,
      StartPeriod: r.from,
      EndPeriod: r.to,
      ReportBasis: r.basis,
      Currency: "USD",
      Option: [{ Name: "NoReportData", Value: "true" }],
    },
    Columns: {
      Column: [
        { ColTitle: "Account", ColType: "Account" },
        { ColTitle: "Total", ColType: "Money" },
      ],
    },
    Rows: {},
  }));
});
it("returns company-scoped report evidence only after authorization revalidation", async () => {
  const result = await quickbooksFinancialReport("cpa", {});
  expect(result).toMatchObject({
    realm: "123",
    company: "Synthetic company",
    mode: "sandbox",
    noData: true,
    metrics: [],
  });
  expect(m.assert).toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("never-return-token");
});
it("blocks unauthorized users before reading provider reports", async () => {
  m.access.mockRejectedValue(new Error("Denied"));
  await expect(quickbooksFinancialReport("customer", {})).rejects.toThrow();
  expect(m.report).not.toHaveBeenCalled();
});
it("rejects a changed company configuration or authorization revoked during provider reads", async () => {
  m.config.mockResolvedValue({ ...config, fingerprint: "changed" });
  await expect(quickbooksFinancialReport("admin", {})).rejects.toThrow();
  m.config.mockResolvedValue(config);
  m.assert.mockRejectedValue(new Error("Revoked"));
  await expect(quickbooksFinancialReport("admin", {})).rejects.toThrow();
});
it("does not convert provider failures into zero-valued reports", async () => {
  m.report.mockRejectedValue(new Error("Unavailable"));
  await expect(quickbooksFinancialReport("cpa", {})).rejects.toThrow();
});
