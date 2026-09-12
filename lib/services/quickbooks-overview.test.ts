import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  access: vi.fn(),
  config: vi.fn(),
  count: vi.fn(),
  records: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("./finance", () => ({ financeAccess: m.access }));
vi.mock("@/lib/integrations/quickbooks-client", () => ({ quickbooksConfig: m.config }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
import { quickbooksOverview, quickbooksOverviewRecords } from "./quickbooks-overview";
beforeEach(() => {
  vi.resetAllMocks();
  m.access.mockResolvedValue(true);
  m.config.mockResolvedValue({ mode: "sandbox", realm: "123" });
  m.count.mockResolvedValue(2);
  m.records.mockResolvedValue([]);
  m.transaction.mockImplementation((fn) =>
    fn({
      $executeRaw: m.execute,
      qboReceiptExport: { count: m.count, findMany: m.records },
      qboExpenseExport: { count: m.count, findMany: m.records },
      qboCostExport: { count: m.count, findMany: m.records },
    }),
  );
});
it("rejects unauthorized reads before consulting company configuration or accounting data", async () => {
  m.access.mockRejectedValue(new Error("Financial access required"));
  await expect(quickbooksOverview("customer")).rejects.toThrow(
    "Financial access required",
  );
  await expect(quickbooksOverviewRecords("customer", "sales")).rejects.toThrow();
  expect(m.config).not.toHaveBeenCalled();
  expect(m.transaction).not.toHaveBeenCalled();
});
it("does not report false zero totals or query other companies without a configured company", async () => {
  m.config.mockRejectedValue(new Error("missing credentials"));
  expect((await quickbooksOverview("admin")).counts).toBeNull();
  expect(await quickbooksOverviewRecords("admin", "sales")).toEqual([]);
  expect(m.transaction).not.toHaveBeenCalled();
});
it("scopes every metric and detail to company and mode, while keeping old unresolved corrections visible", async () => {
  const result = await quickbooksOverview("admin", "day");
  expect(result.counts).toMatchObject({ sales: 2, corrections: 6, pending: 6 });
  for (const [args] of m.count.mock.calls)
    expect(args.where).toMatchObject({ mode: "sandbox", realm: "123" });
  const correction = m.count.mock.calls.filter(
    ([args]) => args.where.reconciliationIssue,
  );
  for (const [args] of correction) {
    expect(args.where).not.toHaveProperty("confirmedAt");
    expect(args.where.status).toEqual({ not: "CANCELED" });
  }
  await quickbooksOverviewRecords("admin", "sales", "day");
  expect(m.records).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        mode: "sandbox",
        realm: "123",
        entity: "SalesReceipt",
        status: "POSTED",
      }),
      take: 50,
    }),
  );
});
