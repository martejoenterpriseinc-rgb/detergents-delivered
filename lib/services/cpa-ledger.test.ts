import { beforeEach, expect, it, vi } from "vitest";
import { AccountError } from "@/lib/domain/account";
const mock = vi.hoisted(() => ({
  sales: vi.fn(),
  refunds: vi.fn(),
  returns: vi.fn(),
  access: vi.fn(),
  sale: vi.fn(),
  refund: vi.fn(),
  cost: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: mock.execute,
        order: { findMany: mock.sales },
        refundAdjustment: { findMany: mock.refunds },
        stockReturn: { findMany: mock.returns },
      }),
  },
}));
vi.mock("./finance", () => ({ financeAccess: mock.access }));
vi.mock("./sales-refund-source", () => ({
  recordedSaleSource: mock.sale,
  recordedRefundSource: mock.refund,
}));
vi.mock("./quickbooks-cost-source", () => ({ recordedOrderCost: mock.cost }));
vi.mock("@/lib/integration-environment", () => ({
  integrationEnvironment: () => "sandbox",
}));
import { readCpaLedger } from "./cpa-ledger";
beforeEach(() => {
  vi.resetAllMocks();
  mock.sales.mockResolvedValue([]);
  mock.refunds.mockResolvedValue([]);
  mock.returns.mockResolvedValue([]);
  mock.sale.mockResolvedValue({
    cashCents: 108,
    netCents: 100,
    taxCents: 8,
    rewardsCents: 0,
    subtotalCents: 100,
    promotionCents: 0,
  });
  mock.cost.mockResolvedValue({ amountCents: 40 });
});
it("uses full Chicago DST day and environment filters for each independent event date", async () => {
  await readCpaLedger("cpa", { from: "2026-03-08", to: "2026-03-08" });
  const dates = {
    gte: new Date("2026-03-08T06:00:00Z"),
    lt: new Date("2026-03-09T05:00:00Z"),
  };
  expect(mock.sales).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        placedAt: dates,
        checkoutAttempt: { state: "PAID", livemode: false },
      }),
    }),
  );
  expect(mock.refunds).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ createdAt: dates }) }),
  );
  expect(mock.returns).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ receivedAt: dates }) }),
  );
  expect(mock.execute.mock.calls[0][0][0]).toBe("SET TRANSACTION READ ONLY");
});
it("keeps whole-range totals on later pages and exports every selected event", async () => {
  mock.sales.mockResolvedValue(
    Array.from({ length: 51 }, (_, i) => ({
      id: String(i).padStart(3, "0"),
      number: "sale",
      placedAt: new Date("2026-02-01T18:00:00Z"),
    })),
  );
  const filter = { from: "2026-02-01", to: "2026-02-01", page: "2" };
  const data = await readCpaLedger("cpa", filter);
  expect(data.rows).toHaveLength(1);
  expect(data.rows[0].sourceId).toBe("050");
  expect(data.totals.cashCents).toBe(5508);
  expect((await readCpaLedger("cpa", filter, true)).rows).toHaveLength(51);
});
it("rejects an oversized combined range rather than exporting a truncated ledger", async () => {
  mock.sales.mockResolvedValue(Array(200).fill({}));
  mock.refunds.mockResolvedValue(Array(51).fill({}));
  await expect(readCpaLedger("cpa", {})).rejects.toMatchObject({ status: 422 });
  expect(mock.sale).not.toHaveBeenCalled();
});
it("does not hide database failures as missing historical evidence", async () => {
  mock.sales.mockResolvedValue([{ id: "order", number: "sale", placedAt: new Date() }]);
  mock.sale.mockRejectedValue(new Error("Connection lost"));
  await expect(readCpaLedger("cpa", {})).rejects.toThrow("Connection lost");
});
it("blocks unauthorized readers before scanning records", async () => {
  mock.access.mockRejectedValue(new AccountError("Forbidden", 403));
  await expect(readCpaLedger("customer", {})).rejects.toMatchObject({ status: 403 });
  expect(mock.sales).not.toHaveBeenCalled();
});
it("keeps a return with missing cost noncash and leaves its cost unknown", async () => {
  mock.returns.mockResolvedValue([
    { id: "return", orderId: "order", order: { number: "sale" }, receivedAt: new Date() },
  ]);
  mock.cost.mockRejectedValue(new AccountError("Incomplete cost", 409));
  const data = await readCpaLedger("cpa", {});
  expect(data).toMatchObject({
    missingFinancial: 0,
    missingCost: 1,
    merchandiseLessCostCents: null,
  });
  expect(data.rows[0]).toMatchObject({
    cashCents: 0,
    taxCents: 0,
    rewardCents: 0,
    costCents: null,
  });
});
