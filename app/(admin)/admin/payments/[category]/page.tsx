import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/authz";
import { paymentCategory, paymentCategories } from "@/lib/domain/payment-overview";
import { readPaymentOverview } from "@/lib/services/payment-overview";
import { formatCents } from "@/lib/domain/money";
import { ReconcileButton } from "@/components/commerce/admin-actions";
import { PaymentOverviewLive } from "@/components/admin/payment-overview-live";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ period?: string; page?: string }>;
}) {
  await requireRole("ADMIN", "SUPER_ADMIN");
  const parsed = paymentCategory.safeParse((await params).category);
  if (!parsed.success) notFound();
  const category = parsed.data,
    query = await searchParams;
  const page = /^\d{1,5}$/.test(query.page ?? "") ? Math.max(1, Number(query.page)) : 1;
  const data = await readPaymentOverview(query.period, category, page),
    metric = data.metrics[category];
  const unavailable = ["blocked", "net"].includes(category);
  return (
    <div className="space-y-6">
      <Link
        href={{ pathname: "/admin/payments", query: { period: data.range.period } }}
        className="font-semibold underline"
      >
        ← Payments overview
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">{paymentCategories[category]}</h1>
        <a
          href={data.stripeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ops-button"
        >
          Open Stripe dashboard ↗
        </a>
      </div>
      <PaymentOverviewLive balances={category === "balance"} />
      <p>
        {data.range.from} – {data.range.to} · America/Chicago ·{" "}
        {data.live ? "Live" : "Sandbox"}
      </p>
      {unavailable ? (
        <p className="rounded-xl border bg-white p-5">
          {category === "net"
            ? "Net volume after provider fees is not yet imported. Gross receipts are not net deposits."
            : "Stripe blocked-attempt evidence is not yet imported. A failed payment or checkout needing review is not automatically a blocked payment."}{" "}
          Open Stripe for its provider report.
        </p>
      ) : (
        category !== "balance" && (
          <>
            <p className="text-2xl font-semibold">
              {metric.cents !== null ? formatCents(metric.cents) : "Amount unavailable"} ·{" "}
              {metric.count} {category === "refunded" ? "entries" : "records"}
            </p>
            {data.payments.map((r) => (
              <article key={r.id} className="space-y-2 rounded-xl border bg-white p-5">
                <Link
                  href={{ pathname: `/admin/orders/${r.orderId}` }}
                  className="font-semibold underline"
                >
                  {r.order.number}
                </Link>
                <p>
                  {formatCents(r.amountCents)} · {r.status}
                </p>
                <p className="text-sm break-all">
                  {r.externalId ?? "Provider identity unavailable"}
                </p>
                <time>{r.createdAt.toISOString()}</time>
              </article>
            ))}
            {data.adjustments.map((r) => (
              <article key={r.id} className="space-y-2 rounded-xl border bg-white p-5">
                <Link
                  href={{ pathname: `/admin/orders/${r.request.orderId}` }}
                  className="font-semibold underline"
                >
                  {r.request.order.number}
                </Link>
                <p>
                  {formatCents(r.cashCents)} · {r.kind}
                </p>
                <p className="text-sm break-all">
                  {r.providerRefundId ?? "No provider refund identity"}
                </p>
                <time>{r.createdAt.toISOString()}</time>
              </article>
            ))}
            {data.attempts.map((r) => (
              <article key={r.id} className="space-y-2 rounded-xl border bg-white p-5">
                <p className="break-all">
                  {r.order?.number ?? r.id} · {r.state}
                </p>
                {r.stripeSessionId && <ReconcileButton id={r.id} />}
              </article>
            ))}
            {!data.payments.length &&
              !data.adjustments.length &&
              !data.attempts.length && (
                <p>No records on this page for the selected period.</p>
              )}
            <nav className="flex gap-4" aria-label="Payment pagination">
              {page > 1 && (
                <Link
                  href={{
                    pathname: `/admin/payments/${category}`,
                    query: { period: data.range.period, page: page - 1 },
                  }}
                  className="ops-button"
                >
                  Previous
                </Link>
              )}
              {page * 50 < (metric.count ?? 0) && (
                <Link
                  href={{
                    pathname: `/admin/payments/${category}`,
                    query: { period: data.range.period, page: page + 1 },
                  }}
                  className="ops-button"
                >
                  Next
                </Link>
              )}
            </nav>
          </>
        )
      )}
    </div>
  );
}
