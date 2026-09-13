import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), report: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/account-api", async (original) => ({
  ...(await original<object>()),
  accountRequest: m.actor,
}));
vi.mock("@/lib/services/quickbooks-financial-report", () => ({
  quickbooksFinancialReport: m.report,
}));
import { GET } from "./route";
import { AccountError } from "@/lib/domain/account";
const data = () => ({
  company: "=UNTRUSTED()",
  realm: "123",
  mode: "sandbox",
  name: "ProfitAndLoss",
  period: { from: "2024-01-01", to: "2024-12-31" },
  header: { ReportBasis: "Accrual" },
  checkedAt: "2026-09-13T12:00:00Z",
  noData: false,
  columns: [{ ColTitle: "Account" }, { ColTitle: "Total" }],
  metrics: [{ section: "0", label: "Income" }],
  rows: [
    { section: "0", kind: "summary", depth: 0, values: ["Income", "123.45"] },
    { section: "1", kind: "data", depth: 0, values: ["Other", "0.00"] },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  m.actor.mockResolvedValue("cpa");
  m.report.mockResolvedValue(data());
});
it("exports verified section records with scope metadata and formula escaping", async () => {
  const r = await GET(
    new Request(
      "https://example.test/api/admin/quickbooks/financial-report?format=csv&section=0&sectionLabel=Income&period=custom&from=2024-01-01&to=2024-12-31",
    ),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  expect(r.headers.get("Content-Disposition")).toContain(
    "quickbooks-ProfitAndLoss-2024-12-31.csv",
  );
  const text = await r.text();
  expect(text).toContain("'=UNTRUSTED()");
  expect(text).toContain('"sandbox"');
  expect(text).toContain('"123.45"');
  expect(text).not.toContain('"Other"');
  expect(m.report).toHaveBeenCalledWith(
    "cpa",
    expect.objectContaining({ from: "2024-01-01", to: "2024-12-31", period: "custom" }),
  );
});
it("does not download fabricated zeroes for a no-data report", async () => {
  m.report.mockResolvedValue({ ...data(), noData: true, rows: [], metrics: [] });
  const r = await GET(
    new Request("https://example.test/api/admin/quickbooks/financial-report?format=csv"),
  );
  const text = await r.text();
  expect(text).toContain("NO_REPORT_DATA");
  expect(text).not.toContain("0.00");
});
it("blocks unauthorized requests, stale sections and provider failures", async () => {
  m.actor.mockRejectedValueOnce(new AccountError("Please sign in.", 401));
  expect(
    (
      await GET(
        new Request(
          "https://example.test/api/admin/quickbooks/financial-report?format=csv",
        ),
      )
    ).status,
  ).toBe(401);
  expect(m.report).not.toHaveBeenCalled();
  expect(
    (
      await GET(
        new Request(
          "https://example.test/api/admin/quickbooks/financial-report?format=csv&section=deleted",
        ),
      )
    ).status,
  ).toBe(409);
  m.report.mockRejectedValue(new Error("private provider error"));
  const r = await GET(
    new Request("https://example.test/api/admin/quickbooks/financial-report?format=csv"),
  );
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("private provider error");
});
