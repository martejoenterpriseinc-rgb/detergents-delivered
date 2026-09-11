import { ZodError } from "zod";
import { requireRole } from "@/lib/authz";
import { readTaxReview } from "@/lib/services/tax-review";
import { AccountError } from "@/lib/domain/account";
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  let data;
  try {
    data = await readTaxReview(session.user.id, await searchParams);
  } catch (error) {
    if (
      !(error instanceof ZodError) &&
      !(error instanceof AccountError && error.status === 422)
    )
      throw error;
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Taxes</h1>
        <p role="alert">
          Choose valid dates within one year. Narrow the range if it contains too many
          records.
        </p>
        <a className="ops-button" href="/admin/taxes">
          Reset filters
        </a>
      </div>
    );
  }
  const { from, to, page } = data.filter;
  const pageLink = (next: number) =>
    `/admin/taxes?${new URLSearchParams({ from, to, page: String(next) })}`;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-teal-950">Taxes</h1>
      <form action="/admin/taxes" method="get" className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          From
          <input
            className="rounded-lg border p-2"
            type="date"
            name="from"
            defaultValue={from}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <input
            className="rounded-lg border p-2"
            type="date"
            name="to"
            defaultValue={to}
            required
          />
        </label>
        <button className="ops-button" type="submit">
          Apply dates
        </button>
      </form>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["Recorded sale tax", money(data.saleTaxCents)],
          ["Net refund tax allocations", money(data.refundTaxCents)],
          ["Awaiting provider tax matching", String(data.unverifiedAdjustments)],
        ].map(([label, value]) => (
          <section
            key={label}
            aria-label={label}
            className="min-w-0 rounded-xl border border-teal-100 bg-white p-5"
          >
            <h2 className="text-base">{label}</h2>
            <p className="mt-2 text-3xl font-semibold break-words">{value}</p>
          </section>
        ))}
      </div>
      <p className="text-sm text-slate-700">
        USD records use Chicago business dates. Refund allocations use saved item tax
        amounts; compensation reverses those allocations. Provider tax matching is
        pending. These totals are not a tax return or an amount due.
      </p>
      {data.excludedOrders > 0 && (
        <p role="alert">
          {data.excludedOrders} orders require payment or tax evidence review and are
          excluded from the sale tax total.
        </p>
      )}
      <section aria-label="Tax records" className="space-y-3">
        <h2 className="text-xl font-semibold">Recorded activity</h2>
        {!data.rows.length && <p>No records for these dates.</p>}
        {data.rows.map((row) => (
          <article
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4"
          >
            <div className="min-w-0">
              <a className="break-all underline" href={`/admin/orders/${row.orderId}`}>
                {row.number}
              </a>
              <p className="text-sm">
                {row.kind === "SALE"
                  ? "Sale"
                  : row.kind === "SETTLEMENT"
                    ? "Refund allocation"
                    : "Refund compensation"}
              </p>
              <p className="text-sm text-slate-600">
                {new Date(row.date).toLocaleDateString("en-US", {
                  timeZone: "America/Chicago",
                })}{" "}
                · {row.evidence}
              </p>
            </div>
            <strong>{money(row.taxCents)}</strong>
          </article>
        ))}
      </section>
      <nav aria-label="Tax record pages" className="flex flex-wrap gap-3">
        {page > 1 && (
          <a className="ops-button secondary" href={pageLink(page - 1)}>
            Previous
          </a>
        )}
        {page * 50 < data.count && (
          <a className="ops-button secondary" href={pageLink(page + 1)}>
            Next
          </a>
        )}
      </nav>
    </div>
  );
}
