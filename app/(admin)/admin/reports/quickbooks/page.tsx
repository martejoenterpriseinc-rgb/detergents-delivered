import Link from "next/link";
import { PaymentOverviewLive } from "@/components/admin/payment-overview-live";
import {
  quickbooksCategories,
  quickbooksOverview,
} from "@/lib/services/quickbooks-overview";
import { requireRole } from "@/lib/authz";
import { quickbooksConnectionStatus } from "@/lib/services/quickbooks-connection";
import { QuickbooksConnection } from "@/components/admin/quickbooks-connection";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ connection?: string; period?: string }>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  const params = await searchParams;
  const overview = await quickbooksOverview(session.user.id, params.period);
  return (
    <div className="space-y-8">
      <section className="space-y-5">
        <h1 className="text-3xl font-semibold">QuickBooks dashboard</h1>
        <p>
          Detergents Delivered accounting activity for company{" "}
          {overview.realm ?? "not configured"} ({overview.mode ?? "unavailable"}).
        </p>
        <PaymentOverviewLive provider="quickbooks" />
        <nav aria-label="QuickBooks reporting period" className="flex flex-wrap gap-3">
          {(["day", "week", "month", "year"] as const).map((period) => (
            <Link
              key={period}
              href={`/admin/reports/quickbooks?period=${period}`}
              aria-current={period === overview.period.period ? "page" : undefined}
              className={`inline-flex min-h-14 min-w-24 items-center justify-center rounded-xl border px-6 text-lg font-semibold ${period === overview.period.period ? "bg-teal-700 text-white" : "bg-white"}`}
            >
              {period[0].toUpperCase() + period.slice(1)}
            </Link>
          ))}
        </nav>
        <p>
          Confirmed exports: {overview.period.from}–{overview.period.to}. Pending
          reconciliation and corrections include all outstanding periods.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(quickbooksCategories).map(([key, label]) => (
            <Link
              key={key}
              href={`/admin/reports/quickbooks/${key}?period=${overview.period.period}`}
              className="rounded-xl border bg-white p-5 hover:border-teal-700"
            >
              <span className="block font-semibold">{label}</span>
              <span className="my-3 block text-3xl">
                {overview.counts?.[key as keyof typeof quickbooksCategories] ??
                  "Unavailable"}
              </span>
              <span className="text-sm underline">View details →</span>
            </Link>
          ))}
        </div>
        <p className="text-sm">
          Snapshot: {overview.checkedAt}. These are application export records. Company
          revenue, profit, cash flow, receivables and payables require QuickBooks
          financial report integration.
        </p>
      </section>
      <div id="accounting-workflows">
        <QuickbooksConnection
          status={await quickbooksConnectionStatus(session.user.id)}
          callback={params.connection}
        />
      </div>
    </div>
  );
}
