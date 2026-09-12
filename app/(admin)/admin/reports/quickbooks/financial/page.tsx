import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/authz";
import { AccountError } from "@/lib/domain/account";
import {
  financialReports,
  financialReportName,
  reportUsesRange,
  reportUsesBasis,
} from "@/lib/domain/quickbooks-financial-report";
import { paymentPeriod } from "@/lib/domain/payment-overview";
import { quickbooksFinancialReport } from "@/lib/services/quickbooks-financial-report";
import { PaymentOverviewLive } from "@/components/admin/payment-overview-live";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    report?: string;
    period?: string;
    basis?: string;
    section?: string;
  }>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  const params = await searchParams;
  const parsed = financialReportName.safeParse(params.report ?? "ProfitAndLoss");
  if (!parsed.success) notFound();
  const report = parsed.data,
    period = paymentPeriod(params.period),
    basis = params.basis === "Cash" ? "Cash" : "Accrual";
  const href = (changes: Record<string, string>) =>
    "/admin/reports/quickbooks/financial?" +
    new URLSearchParams({ report, period: period.period, basis, ...changes });
  let data,
    error = "";
  try {
    data = await quickbooksFinancialReport(session.user.id, {
      report,
      period: period.period,
      basis,
    });
  } catch (e) {
    if (!(e instanceof AccountError)) throw e;
    error = e.message;
  }
  const selected = data?.metrics.find((m) => m.section === params.section);
  const rows = data?.rows.filter(
    (r) =>
      !params.section ||
      (selected &&
        (r.section === selected.section || r.section.startsWith(selected.section + "."))),
  );
  const money = (n: number | null) =>
    n === null
      ? "Unavailable"
      : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
          n / 100,
        );
  return (
    <div className="space-y-6">
      <Link href="/admin/reports/quickbooks">← QuickBooks dashboard</Link>
      <h1 className="text-3xl font-semibold">Financial reports</h1>
      <PaymentOverviewLive provider="quickbooks" />
      <nav aria-label="Financial report" className="flex flex-wrap gap-3">
        {Object.entries(financialReports).map(([key, label]) => (
          <Link
            key={key}
            href={href({ report: key })}
            aria-current={key === report ? "page" : undefined}
            className={`rounded-xl border p-4 font-semibold ${key === report ? "bg-teal-700 text-white" : "bg-white"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <nav aria-label="Financial reporting period" className="flex flex-wrap gap-3">
        {["day", "week", "month", "year"].map((p) => (
          <Link
            key={p}
            href={href({ period: p })}
            aria-current={p === period.period ? "page" : undefined}
            className={`inline-flex min-h-14 min-w-24 items-center justify-center rounded-xl border px-6 text-lg font-semibold ${p === period.period ? "bg-teal-700 text-white" : "bg-white"}`}
          >
            {p[0].toUpperCase() + p.slice(1)}
          </Link>
        ))}
      </nav>
      {reportUsesBasis(report) && (
        <nav aria-label="Accounting basis" className="flex gap-3">
          {["Accrual", "Cash"].map((b) => (
            <Link
              key={b}
              href={href({ basis: b })}
              aria-current={basis === b ? "page" : undefined}
              className="rounded-xl border px-5 py-3"
            >
              {b} basis
            </Link>
          ))}
        </nav>
      )}
      <h2 className="text-2xl font-semibold">{financialReports[report]}</h2>
      <p>
        {reportUsesRange(report)
          ? `${period.from} through ${period.to}`
          : `Balances as of ${period.to}. Day/week/month/year select the current period ending today; balance reports show that ending position.`}
      </p>
      {error && (
        <p role="alert" className="rounded-xl border p-5">
          {error} Financial amounts are unavailable until a complete report can be
          verified.
        </p>
      )}
      {data && (
        <>
          <p>
            {data.company} · Company {data.realm} · {data.mode} · USD ·{" "}
            {data.header.ReportBasis ?? "Provider report basis"} · Checked{" "}
            {data.checkedAt}
          </p>
          <p>
            These figures cover the connected QuickBooks company. Unposted Detergents
            Delivered activity is not included.
          </p>
          {data.noData ? (
            <p>No report data was returned for this selection.</p>
          ) : (
            <>
              {params.section ? (
                <>
                  <Link href={href({})}>← All report KPIs</Link>
                  <h3 className="text-xl font-semibold">
                    {selected?.label ??
                      "This report section is no longer available. Return to all KPIs."}
                  </h3>
                </>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {data.metrics.map((metric) => (
                    <Link
                      key={metric.id}
                      href={href({ section: metric.section })}
                      className="rounded-xl border bg-white p-5 hover:border-teal-700"
                    >
                      <span className="block font-semibold">{metric.label}</span>
                      <span className="block text-sm">{metric.column}</span>
                      <span className="my-3 block text-3xl">{money(metric.cents)}</span>
                      <span className="text-sm underline">View report details →</span>
                    </Link>
                  ))}
                </div>
              )}
              {!!rows?.length && (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm">
                    <caption className="p-3 text-left">
                      Verified QuickBooks report details
                    </caption>
                    <thead>
                      <tr>
                        {data.columns.map((c, i) => (
                          <th key={i} className="border-b p-3 text-left">
                            {c.ColTitle || (i === 0 ? "Account / category" : "Value")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.id}
                          className={
                            row.kind === "summary"
                              ? "border-t bg-teal-50 font-semibold"
                              : "border-t"
                          }
                        >
                          {row.values.map((v, i) => (
                            <td key={i} className="p-3 align-top">
                              {v || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
