import { parseCsv } from "@/lib/domain/csv";
import { createHash } from "node:crypto";
import { AccountError } from "@/lib/domain/account";
import { readCommerce } from "./runtime";
import { stripeClient } from "./stripe";

const fail = () =>
  new AccountError("The tax report could not be matched. No tax evidence changed.", 409);
const maxBytes = 2_000_000;
export const taxReportColumns = [
  "id",
  "tax_transaction_id",
  "reversal_original_tax_transaction_id",
  "provider",
  "applied_tax_calculation_type",
  "type",
  "transaction_type",
  "payment_intent_id",
  "line_item_id",
  "currency",
  "total",
  "tax_amount",
  "country_code",
  "state_code",
  "jurisdiction_level",
  "jurisdiction_name",
  "tax_type",
  "tax_rate",
] as const;

// Bounded RFC 4180 reader. No uploaded values are evaluated or rendered as HTML.
export function taxReportRows(csv: string) {
  const rows = parseCsv(csv);
  const headers = rows.shift();
  if (
    !headers ||
    new Set(headers).size !== headers.length ||
    taxReportColumns.some((c) => !headers.includes(c))
  )
    throw fail();
  return rows.map((values) => {
    if (values.length !== headers.length) throw fail();
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
  });
}
function cents(value: string) {
  if (!/^-?\d{1,9}(?:\.\d{1,2})?$/.test(value)) throw fail();
  const sign = value.startsWith("-") ? -1 : 1;
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const result = sign * (Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
  if (!Number.isSafeInteger(result)) throw fail();
  return result;
}
export type TaxRefundBinding = {
  accountId: string;
  live: boolean;
  paymentIntentId: string;
  sessionId: string;
  providerRefundId: string;
  saleTotalCents: number;
  saleTaxCents: number;
  refundCents: number;
  refundTaxCents: number;
  currency: string;
};
export function matchTaxReport(csv: string, binding: TaxRefundBinding) {
  const relevant = taxReportRows(csv).filter(
    (r) =>
      r.id === binding.sessionId ||
      r.id === binding.providerRefundId ||
      r.payment_intent_id === binding.paymentIntentId,
  );
  const summarize = (id: string, type: string, transactionType: string) => {
    const selected = relevant.filter((r) => r.id === id);
    if (!selected.length) throw fail();
    const transactions = new Set(selected.map((r) => r.tax_transaction_id));
    if (
      transactions.size !== 1 ||
      !/^tax_[A-Za-z0-9]+$/.test(selected[0].tax_transaction_id)
    )
      throw fail();
    const seen = new Set<string>(),
      lines = new Map<string, number>();
    let tax = 0;
    for (const r of selected) {
      if (
        r.provider !== "stripe" ||
        r.applied_tax_calculation_type !== "automatic" ||
        r.type !== type ||
        r.transaction_type !== transactionType ||
        r.currency.toUpperCase() !== binding.currency ||
        r.payment_intent_id !== binding.paymentIntentId ||
        !r.line_item_id
      )
        throw fail();
      const key = JSON.stringify([
        r.line_item_id,
        r.country_code,
        r.state_code,
        r.jurisdiction_level,
        r.jurisdiction_name,
        r.tax_type,
        r.tax_rate,
      ]);
      if (seen.has(key)) throw fail();
      seen.add(key);
      const total = cents(r.total);
      if (lines.has(r.line_item_id) && lines.get(r.line_item_id) !== total) throw fail();
      lines.set(r.line_item_id, total);
      tax += cents(r.tax_amount);
    }
    return {
      id: selected[0].tax_transaction_id,
      total: [...lines.values()].reduce((a, b) => a + b, 0),
      tax,
      rows: selected,
    };
  };
  const sale = summarize(binding.sessionId, "checkout", "transaction");
  const refund = summarize(binding.providerRefundId, "refund", "reversal");
  if (
    sale.total !== binding.saleTotalCents ||
    sale.tax !== binding.saleTaxCents ||
    refund.total !== -binding.refundCents ||
    refund.tax !== -binding.refundTaxCents ||
    sale.rows.some((r) => r.reversal_original_tax_transaction_id) ||
    refund.rows.some((r) => r.reversal_original_tax_transaction_id !== sale.id)
  )
    throw fail();
  return {
    originalTaxTransactionId: sale.id,
    refundTaxTransactionId: refund.id,
    taxCents: -refund.tax,
    reportHash: createHash("sha256").update(csv).digest("hex"),
  };
}

/** Reads an existing completed Stripe report only. Does not create reports or tax reversals. */
export async function readRefundTaxEvidence(
  reportRunId: string,
  binding: TaxRefundBinding,
) {
  if (!/^frr_[A-Za-z0-9]+$/.test(reportRunId)) throw fail();
  try {
    const config = await readCommerce(true);
    if (config.accountId !== binding.accountId || config.live !== binding.live)
      throw fail();
    const stripe = await stripeClient(config);
    const options = { timeout: 8000, maxNetworkRetries: 0 };
    const [account, report] = await Promise.all([
      stripe.accounts.retrieve(null, {}, options),
      stripe.reporting.reportRuns.retrieve(reportRunId, {}, options),
    ]);
    if (
      account.id !== binding.accountId ||
      report.id !== reportRunId ||
      report.livemode !== binding.live ||
      report.status !== "succeeded" ||
      report.report_type !== "tax.itemized_export.1" ||
      !report.result ||
      !/^file_[A-Za-z0-9]+$/.test(report.result.id) ||
      report.result.size > maxBytes ||
      Object.keys(report.parameters).some(
        (k) =>
          ![
            "interval_start",
            "interval_end",
            "timezone",
            "decimal_separator",
            "columns",
          ].includes(k),
      )
    )
      throw fail();
    // Fixed host/path, no caller URLs or redirects; credentials never leave Stripe.
    const response = await fetch(
      `https://files.stripe.com/v1/files/${report.result.id}/contents`,
      {
        headers: { Authorization: `Bearer ${config.key}` },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok || !response.body) throw fail();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) throw fail();
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const csv = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return { ...matchTaxReport(csv, binding), reportRunId, fileId: report.result.id };
  } catch {
    throw fail();
  }
}
