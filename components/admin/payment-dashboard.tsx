import Link from "next/link";
import { ReconcileButton } from "@/components/commerce/admin-actions";
import { readPaymentOverview, type PaymentRecord } from "@/lib/services/payment-overview";
import {
  paymentCategories,
  unavailableMetrics,
  paymentQuery,
  type PaymentCategory,
} from "@/lib/domain/payment-overview";
import { formatCents } from "@/lib/domain/money";
import { PaymentOverviewLive } from "./payment-overview-live";
type Data = Awaited<ReturnType<typeof readPaymentOverview>>;
const date = (v: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v.endsWith("Z") ? v : v + "Z"));
function Trend({ rows }: { rows: Data["trend"] }) {
  if (!rows.length || rows.every((r) => r.gross === 0 && r.net === 0 && r.refunds === 0))
    return <p>No collected payments or refund entries in this period.</p>;
  const max = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.gross), Math.abs(r.net)]));
  const points = (key: "gross" | "net") =>
    rows
      .map(
        (r, i) =>
          `${20 + (i * 560) / Math.max(1, rows.length - 1)},${110 - (r[key] / max) * 85}`,
      )
      .join(" ");
  return (
    <>
      <svg
        viewBox="0 0 600 220"
        role="img"
        aria-label="Gross collected and net after refunds trend"
        className="w-full"
      >
        <line x1="20" y1="110" x2="580" y2="110" stroke="#cbd5e1" />
        <polyline points={points("gross")} fill="none" stroke="#0f766e" strokeWidth="3" />
        <polyline points={points("net")} fill="none" stroke="#7c3aed" strokeWidth="3" />
        {rows.length === 1 && (
          <circle cx="20" cy={110 - (rows[0].gross / max) * 85} r="4" fill="#0f766e" />
        )}
        <text x="20" y="210" fontSize="12">
          {rows[0].date}
        </text>
        <text x="490" y="210" fontSize="12">
          {rows.at(-1)?.date}
        </text>
      </svg>
      <p className="text-sm">Teal: gross collected · Purple: net after refunds · USD</p>
      <details>
        <summary className="cursor-pointer py-3 underline">Exact trend amounts</summary>
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Period starts</th>
                <th>Gross</th>
                <th>Refunds</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <td>{r.date}</td>
                  <td>{formatCents(r.gross)}</td>
                  <td>{formatCents(r.refunds)}</td>
                  <td>{formatCents(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
export function PaymentDashboard({
  data,
  category,
}: {
  data: Data;
  category?: PaymentCategory;
}) {
  const f = data.filter,
    url = (
      key?: PaymentCategory,
      overrides: Record<string, string | number | undefined> = {},
    ) =>
      `${key ? "/admin/payments/" + key : "/admin/payments"}?${paymentQuery(f, { page: 1, ...overrides })}`;
  const metric = category ? data.metrics[category] : null;
  function record(r: PaymentRecord) {
    return (
      <article key={r.id} className="min-w-0 space-y-2 rounded-xl border bg-white p-5">
        <div className="flex flex-wrap justify-between gap-2">
          <strong>
            {r.cents === null ? "Amount unavailable" : formatCents(r.cents)}
          </strong>
          <span>{r.status}</span>
        </div>
        <p className="break-words">
          {r.customer || "Customer"} · {r.email}
        </p>
        <p>
          {r.method} · {date(r.date)}
        </p>
        <p className="text-sm break-all">Reference: {r.reference || r.id}</p>
        <div className="flex flex-wrap gap-4">
          {r.reference?.startsWith("cs_") &&
            r.categories.some((k) => ["processing", "review"].includes(k)) && (
              <ReconcileButton id={r.id} />
            )}
          {r.order_id && (
            <Link href={`/admin/orders/${r.order_id}`} className="underline">
              Order {r.number}
            </Link>
          )}
          {r.tip_id && (
            <a href={`/admin/reports/tips/${r.tip_id}`} className="underline">
              Tip accounting
            </a>
          )}
          {r.order_id && ["CASH", "ZELLE"].includes(r.method) && (
            <Link href={`/admin/payments/manual/${r.order_id}`} className="underline">
              Manual refund receipts
            </Link>
          )}
          <a href={url("net", { customer: r.customer_id })} className="underline">
            Customer activity
          </a>
        </div>
      </article>
    );
  }
  return (
    <div className="space-y-6">
      {category && (
        <a href={url()} className="underline">
          ← Payments overview
        </a>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">
            {category ? paymentCategories[category] : "Payments"}
          </h1>
          <p className="mt-2">
            <span>
              {data.live ? "Production" : "Sandbox"} · Checkout{" "}
              {data.enabled ? "configured" : "closed"}
            </span>{" "}
            · USD
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/payments/manual" className="ops-button">
            Cash / Zelle settlements
          </Link>
          <Link href="/admin/reports/tips" className="ops-button secondary">
            Delivery tips
          </Link>
          <Link href="/admin/integrations" className="ops-button secondary">
            Manage connection
          </Link>
          <a
            href={data.stripeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ops-button secondary"
          >
            Open Stripe dashboard ↗
          </a>
        </div>
      </div>
      <PaymentOverviewLive
        balances={category === "balance" || category === "pendingBalance"}
      />
      <p className="text-sm">
        Records updated {date(data.checkedAt)}. Internal records refresh with the
        dashboard; provider metrics remain unavailable until connected and verified.
      </p>
      <nav className="flex flex-wrap gap-2" aria-label="Payment date range">
        {Object.entries({
          day: "Today",
          yesterday: "Yesterday",
          week: "Week",
          month: "Month to date",
          previousMonth: "Previous month",
          year: "Year",
        }).map(([period, label]) => (
          <a
            key={period}
            href={url(category, { period, from: undefined, to: undefined })}
            aria-current={f.period === period ? "page" : undefined}
            className={`inline-flex min-h-12 items-center rounded-xl border px-5 py-3 font-semibold ${f.period === period ? "bg-teal-800 text-white" : "bg-white"}`}
          >
            {label}
          </a>
        ))}
      </nav>
      <form
        method="get"
        className="grid gap-3 rounded-xl border bg-white p-5 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Payment filters"
      >
        <input type="hidden" name="period" value="custom" />
        {f.customer && <input type="hidden" name="customer" value={f.customer} />}
        <label>
          From
          <input
            className="mt-1 block w-full rounded-lg border p-3"
            type="date"
            name="from"
            defaultValue={f.range.from}
            required
          />
        </label>
        <label>
          To
          <input
            className="mt-1 block w-full rounded-lg border p-3"
            type="date"
            name="to"
            defaultValue={f.range.to}
            required
          />
        </label>
        <label>
          Payment method
          <select
            name="method"
            defaultValue={f.method}
            className="mt-1 block w-full rounded-lg border p-3"
          >
            {["ALL", "STRIPE", "CASH", "ZELLE"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Trend interval
          <select
            name="interval"
            defaultValue={f.interval}
            className="mt-1 block w-full rounded-lg border p-3"
          >
            {["day", "week", "month"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Search records
          <input
            name="q"
            defaultValue={f.q}
            maxLength={100}
            placeholder="Customer, order, reference"
            className="mt-1 block w-full rounded-lg border p-3"
          />
        </label>
        <label>
          Sort records
          <select
            name="sort"
            defaultValue={f.sort}
            className="mt-1 block w-full rounded-lg border p-3"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amountDesc">Highest amount</option>
            <option value="amountAsc">Lowest amount</option>
          </select>
        </label>
        <button className="ops-button self-end">Apply filters</button>
        <Link href="/admin/payments" className="self-end p-3 underline">
          Reset filters
        </Link>
      </form>
      <p>
        {f.range.from} – {f.range.to} · America/Chicago · Compared with{" "}
        {f.range.previousFrom} – {f.range.previousTo}
      </p>
      {!category && (
        <>
          <section
            aria-label="Payment overview"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {(Object.keys(paymentCategories) as PaymentCategory[]).map((key) => {
              const m = data.metrics[key],
                prev = data.previous[key];
              return (
                <a
                  key={key}
                  href={url(key, key === "customers" ? { sort: "amountDesc" } : {})}
                  className="min-w-0 space-y-3 rounded-2xl border bg-white p-5 hover:border-teal-700 focus-visible:outline-2 focus-visible:outline-teal-700"
                >
                  <h2 className="flex justify-between gap-2 font-semibold">
                    {paymentCategories[key]}
                    <span aria-hidden="true">↗</span>
                  </h2>
                  <strong className="block text-3xl">
                    {unavailableMetrics[key]
                      ? "Unavailable"
                      : m.cents !== null
                        ? formatCents(m.cents)
                        : m.count}
                  </strong>
                  <p className="text-sm">
                    {unavailableMetrics[key]
                      ? "View evidence and connection details"
                      : `${m.count} ${["customers", "newCustomers"].includes(key) ? "customers" : "records"}`}
                  </p>
                  {!unavailableMetrics[key] && (
                    <p className="text-sm text-slate-600">
                      Previous:{" "}
                      {prev.cents !== null
                        ? formatCents(prev.cents)
                        : `${prev.count} customers`}
                      {m.cents !== null && prev.cents !== null
                        ? ` · Change ${formatCents(m.cents - prev.cents)}`
                        : ""}
                    </p>
                  )}
                </a>
              );
            })}
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="min-w-0 rounded-xl border bg-white p-5">
              <h2 className="text-xl font-semibold">Gross and net trends</h2>
              <Trend rows={data.trend} />
            </section>
            <section className="rounded-xl border bg-white p-5">
              <h2 className="text-xl font-semibold">Payment status breakdown</h2>
              {(
                [
                  "succeeded",
                  "processing",
                  "uncaptured",
                  "failed",
                  "declined",
                  "blocked",
                  "canceled",
                  "disputed",
                ] as PaymentCategory[]
              ).map((k) => (
                <a
                  key={k}
                  href={url(k)}
                  className="flex flex-wrap justify-between gap-2 border-b py-3"
                >
                  <span>{paymentCategories[k]}</span>
                  <strong>{data.metrics[k].count ?? "Unavailable"}</strong>
                </a>
              ))}
            </section>
            <section className="min-w-0 space-y-3">
              <h2 className="text-xl font-semibold">Recent failed payments</h2>
              {data.failures.length ? (
                data.failures.map(record)
              ) : (
                <p>No recorded failed payments for these filters.</p>
              )}
              <a href={url("failed")} className="underline">
                View all failed payments
              </a>
            </section>
            <section className="min-w-0 space-y-3">
              <h2 className="text-xl font-semibold">Top customers by spend</h2>
              {data.top.length ? (
                data.top.map((r) => (
                  <a
                    key={r.customer_id}
                    href={url("net", { customer: r.customer_id })}
                    className="block rounded-xl border bg-white p-5"
                  >
                    <p className="break-words">
                      {r.customer} · {r.email}
                    </p>
                    <strong>{formatCents(r.cents ?? 0)}</strong>
                  </a>
                ))
              ) : (
                <p>No customer spend for these filters.</p>
              )}
              <a href={url("customers", { sort: "amountDesc" })} className="underline">
                View all customers
              </a>
            </section>
          </div>
        </>
      )}
      {category && (
        <section aria-label="Payment records" className="space-y-4">
          {unavailableMetrics[category] && (
            <p role="status" className="rounded-xl border bg-amber-50 p-5">
              Unavailable. {unavailableMetrics[category]}
            </p>
          )}
          <div className="flex flex-wrap justify-between gap-3">
            <p className="text-xl font-semibold">
              {metric?.cents == null ? "Amount unavailable" : formatCents(metric.cents)} ·{" "}
              {data.count} matching records
            </p>
            <a
              className="ops-button"
              href={`/api/admin/payments/export?${paymentQuery(f)}&category=${category}`}
            >
              Export CSV
            </a>
          </div>
          {data.rows.map(record)}
          {!data.rows.length && <p>No records on this page for the selected filters.</p>}
          <nav aria-label="Payment pagination" className="flex gap-4">
            {f.page > 1 && (
              <a href={url(category, { page: f.page - 1 })} className="ops-button">
                Previous
              </a>
            )}
            {f.page * 50 < data.count && (
              <a href={url(category, { page: f.page + 1 })} className="ops-button">
                Next
              </a>
            )}
          </nav>
        </section>
      )}
      <details className="rounded-xl border bg-white p-5">
        <summary className="cursor-pointer font-semibold">
          Metric definitions and evidence limits
        </summary>
        <div className="mt-3 space-y-2 text-sm">
          <p>
            Gross collected includes tax and excludes tips and redeemed rewards. It counts
            finalized order payments with saved paid evidence, using the original payment
            date or cash/Zelle receipt date. Unsettled manual receipts remain exceptions.
          </p>
          <p>
            Refunds are signed order refund settlements and compensating entries posted in
            the selected period. Net collected is gross minus those entries; it is not
            profit or a bank deposit. Partial refunds do not reduce the original gross
            payment. Pending/completed/failed refund cards show requests, not extra money
            movement.
          </p>
          <p>
            Customer spend is gross minus refund entries within the selected period,
            excluding tips. New paying customers first paid in this environment and
            account during the period. Payment-method and search filters narrow matching
            records. Comparisons use the preceding equal number of Chicago calendar days.
          </p>
          <p>
            Tips collected excludes tip tax. Tip refunds includes refunded tax; driver
            transfers are signed confirmed transfer records dated by the entered business
            day. Tip eligibility and available payout amounts need current provider
            verification. Operational records do not replace CPA source review.
          </p>
          <p>
            Unsupported provider metrics are unavailable. There is no inferred fraud,
            decline, cancellation, dispute, fee or payout amount. Current provider
            balances, when connected, are account-wide and independent of the date and
            payment-method filters.
          </p>
        </div>
      </details>
    </div>
  );
}
