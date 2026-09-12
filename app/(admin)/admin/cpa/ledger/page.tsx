import Link from "next/link";
import { ZodError } from "zod";
import { requireRole } from "@/lib/authz";
import { AccountError } from "@/lib/domain/account";
import { formatCents } from "@/lib/domain/money";
import { readCpaLedger } from "@/lib/services/cpa-ledger";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  let data;
  try {
    data = await readCpaLedger(session.user.id, await searchParams);
  } catch (e) {
    if (
      !(e instanceof ZodError) &&
      !(e instanceof AccountError && [422, 503].includes(e.status))
    )
      throw e;
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Sales, refunds & cost ledger</h1>
        <p role="alert">
          {e instanceof AccountError ? e.message : "Choose valid dates within one year."}
        </p>
        <Link className="ops-button" href="/admin/cpa/ledger">
          Reset filters
        </Link>
      </div>
    );
  }
  const query = new URLSearchParams({
    from: data.filter.from,
    to: data.filter.to,
    ...(data.filter.orderId ? { orderId: data.filter.orderId } : {}),
  });
  const pageLink = (page: number) => ({
    pathname: "/admin/cpa/ledger",
    query: { ...Object.fromEntries(query), page: String(page) },
  });
  const amount = (v: number | null) =>
    v === null ? "Needs review" : formatCents(v || 0);
  const names = {
    SALE: "Original sale",
    SETTLEMENT: "Settled refund",
    COMPENSATION: "Failed-refund reversal",
    REWARD_ONLY: "Reward-only return",
    STOCK_RETURN: "Returned-stock cost",
  };
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-teal-950">
          Sales, refunds & cost ledger
        </h1>
        <p className="mt-2">Saved USD activity · {data.mode} · Chicago business dates</p>
      </header>
      <form method="get" className="flex flex-wrap items-end gap-3">
        {["from", "to"].map((key) => (
          <label key={key} className="grid gap-1">
            {key === "from" ? "From" : "To"}
            <input
              className="rounded border p-2"
              type="date"
              name={key}
              defaultValue={key === "from" ? data.filter.from : data.filter.to}
              required
            />
          </label>
        ))}
        {data.filter.orderId && (
          <input type="hidden" name="orderId" value={data.filter.orderId} />
        )}
        <button className="ops-button">Apply dates</button>
        <Link className="ops-button secondary" href="/admin/cpa/ledger">
          This month
        </Link>
        <a
          className="ops-button secondary"
          href={`/api/admin/reports/ledger?format=csv&${query}`}
        >
          Export ledger CSV
        </a>
      </form>
      {data.filter.orderId && (
        <p>
          Filtered to one order.{" "}
          <Link
            className="underline"
            href={{
              pathname: "/admin/cpa/ledger",
              query: { from: data.filter.from, to: data.filter.to },
            }}
          >
            Show all orders for these dates
          </Link>
        </p>
      )}
      <p className="text-sm">
        Up to 250 financial events per date range. Totals cover every event in the
        selected range, across all pages. Blank export amounts require review.
      </p>
      {data.attention > 0 && (
        <p role="alert" className="rounded border border-amber-500 bg-amber-50 p-4">
          {data.missingFinancial} events have incomplete financial evidence;{" "}
          {data.missingCost} have incomplete cost evidence; {data.pendingTax} await
          provider tax matching. Totals below include only supported amounts.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Recorded cash change", data.totals.cashCents],
          ["Merchandise after savings", data.totals.netCents],
          ["Recorded tax allocation change", data.totals.taxCents],
          ["Reward credit change", data.totals.rewardCents],
          ["Recorded COGS change", data.totals.costCents],
          ["Merchandise less recorded COGS", data.merchandiseLessCostCents],
        ].map(([label, value]) => (
          <section
            key={label as string}
            aria-label={label as string}
            className="min-w-0 rounded-xl border bg-white p-4"
          >
            <h2>{label}</h2>
            <p className="mt-2 text-2xl font-semibold break-words">
              {amount(value as number | null)}
            </p>
          </section>
        ))}
      </div>
      <p className="text-sm">
        Positive cash is a receipt; negative cash is a settled refund. Positive reward
        credit is a restoration. A sellable stock return reduces COGS independently of its
        refund; damaged returns do not restore inventory cost. These are source amounts,
        not bank deposits, profit, a tax return or a filing balance.
      </p>
      <section className="space-y-3" aria-label="Financial events">
        <h2 className="text-xl font-semibold">Recorded events ({data.count})</h2>
        {!data.rows.length && <p>No recorded events for these dates.</p>}
        {data.rows.map((r) => (
          <article key={r.id} className="space-y-3 rounded-xl border bg-white p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <Link
                className="font-semibold break-all underline"
                href={`/admin/orders/${r.orderId}`}
              >
                {r.number}
              </Link>
              <span>
                {r.date} · {names[r.kind]}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Cash", r.cashCents],
                ["Merchandise", r.netCents],
                ["Tax", r.taxCents],
                ["Cost", r.costCents],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-sm">{k}</dt>
                  <dd>{amount(v as number | null)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm">
              Tax evidence: {r.taxEvidence.toLowerCase().replaceAll("_", " ")}
            </p>
            {r.issues.map((issue) => (
              <p key={issue} className="text-sm text-amber-900">
                {issue}
              </p>
            ))}
          </article>
        ))}
      </section>
      <nav aria-label="Ledger pages" className="flex gap-3">
        {data.filter.page > 1 && (
          <Link className="ops-button" href={pageLink(data.filter.page - 1)}>
            Previous
          </Link>
        )}
        {data.filter.page * 50 < data.count && (
          <Link className="ops-button" href={pageLink(data.filter.page + 1)}>
            Next
          </Link>
        )}
      </nav>
      <Link href="/admin/cpa" className="underline">
        CPA Center
      </Link>
    </div>
  );
}
