import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  account: vi.fn(),
  report: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("./runtime", () => ({ readCommerce: mocks.config }));
vi.mock("./stripe", () => ({
  stripeClient: async () => ({
    accounts: { retrieve: mocks.account },
    reporting: { reportRuns: { retrieve: mocks.report } },
  }),
}));
import {
  taxReportColumns,
  taxReportRows,
  matchTaxReport,
  readRefundTaxEvidence,
} from "./tax-report";
const binding = {
  accountId: "acct_synthetic",
  live: false,
  paymentIntentId: "pi_paid",
  sessionId: "cs_paid",
  providerRefundId: "re_saved",
  saleTotalCents: 1080,
  saleTaxCents: 80,
  refundCents: 540,
  refundTaxCents: 40,
  currency: "USD",
};
const base = {
  provider: "stripe",
  applied_tax_calculation_type: "automatic",
  payment_intent_id: "pi_paid",
  currency: "usd",
  country_code: "US",
  state_code: "IL",
  jurisdiction_level: "state",
  jurisdiction_name: "ILLINOIS",
  tax_type: "sales_tax",
  tax_rate: "0.08",
};
const sale = {
  ...base,
  id: "cs_paid",
  type: "checkout",
  transaction_type: "transaction",
  tax_transaction_id: "tax_sale",
  reversal_original_tax_transaction_id: "",
  line_item_id: "li_sale",
  total: "10.80",
  tax_amount: "0.80",
};
const refund = {
  ...base,
  id: "re_saved",
  type: "refund",
  transaction_type: "reversal",
  tax_transaction_id: "tax_refund",
  reversal_original_tax_transaction_id: "tax_sale",
  line_item_id: "li_refund",
  total: "-5.40",
  tax_amount: "-0.40",
};
const csv = (rows: Record<string, string>[] = [sale, refund]) =>
  [
    taxReportColumns.join(","),
    ...rows.map((r) =>
      taxReportColumns
        .map((c) => '"' + (r[c] ?? "").replaceAll('"', '""') + '"')
        .join(","),
    ),
  ].join("\r\n");
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.config.mockResolvedValue({
    accountId: binding.accountId,
    live: false,
    key: "sk_test_synthetic",
  });
  mocks.account.mockResolvedValue({ id: binding.accountId });
  mocks.report.mockResolvedValue({
    id: "frr_saved",
    livemode: false,
    status: "succeeded",
    report_type: "tax.itemized_export.1",
    parameters: { interval_start: 1, interval_end: 2 },
    result: { id: "file_saved", size: 1000 },
  });
  mocks.fetch.mockImplementation(async () => new Response(csv()));
});
afterEach(() => vi.unstubAllGlobals());
it("matches a linked sale/refund using integer cents and report hash", () => {
  expect(matchTaxReport(csv(), binding)).toEqual({
    originalTaxTransactionId: "tax_sale",
    refundTaxTransactionId: "tax_refund",
    taxCents: 40,
    reportHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});
it("sums jurisdiction tax without counting repeated line totals twice", () => {
  const split = [
    { ...sale, tax_amount: "0.60" },
    {
      ...sale,
      jurisdiction_level: "city",
      jurisdiction_name: 'City, "Central"',
      tax_amount: "0.20",
    },
    { ...refund, tax_amount: "-0.30" },
    {
      ...refund,
      jurisdiction_level: "city",
      jurisdiction_name: 'City, "Central"',
      tax_amount: "-0.10",
    },
  ];
  expect(matchTaxReport(csv(split), binding).taxCents).toBe(40);
  expect(taxReportRows(csv(split))[1].jurisdiction_name).toBe('City, "Central"');
});
it("rejects wrong binding, tax, sign, original transaction, imported evidence and duplicate rows", () => {
  for (const change of [
    { payment_intent_id: "pi_other" },
    { tax_amount: "-0.39" },
    { total: "5.40" },
    { reversal_original_tax_transaction_id: "tax_other" },
    { provider: "external" },
    { applied_tax_calculation_type: "external" },
    { currency: "eur" },
    { tax_amount: "-4e-1" },
  ])
    expect(() =>
      matchTaxReport(csv([sale, { ...refund, ...change }]), binding),
    ).toThrow();
  expect(() => matchTaxReport(csv([sale, refund, refund]), binding)).toThrow();
  expect(() => matchTaxReport(csv([sale]), binding)).toThrow();
});
it("rejects malformed or oversized reports without accepting partial records", () => {
  for (const input of [
    '"unterminated',
    "id,id\na,b",
    csv() + '\n"closed"garbage',
    csv() + "\0",
    "x".repeat(2_000_001),
  ])
    expect(() => taxReportRows(input)).toThrow();
});
it("downloads only a fixed authenticated Stripe file and ignores supplied file URLs", async () => {
  expect(await readRefundTaxEvidence("frr_saved", binding)).toMatchObject({
    reportRunId: "frr_saved",
    fileId: "file_saved",
    taxCents: 40,
  });
  expect(mocks.fetch).toHaveBeenCalledWith(
    "https://files.stripe.com/v1/files/file_saved/contents",
    expect.objectContaining({ redirect: "error", cache: "no-store" }),
  );
});
it("rejects wrong account/mode, filtered/pending reports and unsafe file identifiers before downloading", async () => {
  const report = await mocks.report();
  for (const change of [
    { livemode: true },
    { status: "pending" },
    { parameters: { country: "US" } },
    { result: { id: "../../private", size: 1 } },
    { report_type: "tax.summarized_export.1" },
  ]) {
    mocks.report.mockResolvedValue({ ...report, ...change });
    await expect(readRefundTaxEvidence("frr_saved", binding)).rejects.toMatchObject({
      status: 409,
    });
  }
  mocks.report.mockResolvedValue(report);
  mocks.account.mockResolvedValue({ id: "acct_other" });
  await expect(readRefundTaxEvidence("frr_saved", binding)).rejects.toThrow();
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("bounds downloaded bytes and redacts provider errors", async () => {
  mocks.fetch.mockResolvedValue(new Response("x".repeat(2_000_001)));
  await expect(readRefundTaxEvidence("frr_saved", binding)).rejects.toMatchObject({
    status: 409,
  });
  mocks.fetch.mockRejectedValue(new Error("sk_test_private customer@example.test"));
  await expect(readRefundTaxEvidence("frr_saved", binding)).rejects.toThrow(
    "The tax report could not be matched.",
  );
});
