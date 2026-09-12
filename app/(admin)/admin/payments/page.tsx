import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { formatCents } from "@/lib/domain/money";
import { paymentCategories } from "@/lib/domain/payment-overview";
import { readPaymentOverview } from "@/lib/services/payment-overview";
import { PaymentOverviewLive } from "@/components/admin/payment-overview-live";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireRole("ADMIN", "SUPER_ADMIN");
  const data = await readPaymentOverview((await searchParams).period);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/admin/payments/manual"
            className="inline-flex min-h-12 items-center rounded-xl border px-5 font-semibold"
          >
            Cash / Zelle settlements
          </Link>
          <h1 className="text-3xl font-semibold">Payments</h1>
          <p className="mt-2">
            {data.live ? "Live" : "Sandbox"} · Checkout{" "}
            {data.enabled ? "configured" : "closed"}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href={data.stripeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ops-button"
          >
            Open Stripe dashboard ↗
          </a>
          <Link
            href="/admin/integrations"
            className="rounded-xl border bg-white px-5 py-3 font-semibold"
          >
            Manage connection
          </Link>
        </div>
      </div>
      <PaymentOverviewLive balances />
      <div className="flex flex-wrap gap-3" aria-label="Payment date range">
        {(["day", "week", "month", "year"] as const).map((period) => (
          <Link
            key={period[0].toUpperCase() + period.slice(1)}
            href={{ pathname: "/admin/payments", query: { period } }}
            aria-current={data.range.period === period ? "page" : undefined}
            className={`min-h-14 min-w-28 rounded-xl border px-7 py-4 text-center text-lg font-semibold capitalize ${data.range.period === period ? "bg-teal-800 text-white" : "bg-white text-teal-900"}`}
          >
            {period[0].toUpperCase() + period.slice(1)}
          </Link>
        ))}
      </div>
      <p>
        {data.range.from} – {data.range.to} · America/Chicago · USD
      </p>
      <section
        aria-label="Payment overview"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {Object.entries(paymentCategories).map(([key, label]) => {
          const metric = data.metrics[key];
          return (
            <Link
              key={key}
              href={{
                pathname: `/admin/payments/${key}`,
                query: { period: data.range.period },
              }}
              className="group space-y-3 rounded-2xl border bg-white p-6 transition hover:border-teal-700 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-teal-700"
            >
              <h2 className="flex items-center justify-between text-lg font-semibold">
                {label}
                <span aria-hidden="true">↗</span>
              </h2>
              <strong className="block text-3xl">
                {key === "balance"
                  ? "View balances"
                  : metric.cents !== null
                    ? formatCents(metric.cents)
                    : metric.count !== null
                      ? metric.count
                      : "Unavailable"}
              </strong>
              <p className="text-sm">
                {key === "refunded"
                  ? `${metric.count} settlement/correction entries`
                  : metric.count !== null
                    ? `${metric.count} recorded payments`
                    : "View connection and data details"}
              </p>
            </Link>
          );
        })}
      </section>
      <p className="text-sm">
        Recorded order payments in this environment; tips are reported separately. Gross
        and succeeded amounts include original captures before refunds. Refunds use signed
        settlement and correction entries in the selected period. Net after Stripe fees
        and blocked attempts require provider reporting.
      </p>
      <Link
        href="/admin/reports/tips"
        className="inline-block rounded-xl border bg-white px-5 py-3 font-semibold"
      >
        Delivery tips
      </Link>
    </div>
  );
}
