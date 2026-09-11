import { ZodError } from "zod";
import { requireRole } from "@/lib/authz";
import { financeFilters } from "@/lib/domain/finance";
import { readFinance } from "@/lib/services/finance";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  let filters;
  try {
    filters = financeFilters(await searchParams);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">CPA Center</h1>
        <p role="alert">Choose valid dates in a range of up to one year.</p>
        <a className="ops-button" href="/admin/cpa">
          Reset filters
        </a>
      </div>
    );
  }
  const { from, to } = filters;
  const [expenses, mileage] = await Promise.all([
    readFinance(session.user.id, "expense", { from, to }),
    readFinance(session.user.id, "mileage", { from, to }),
  ]);
  const query = new URLSearchParams({ from, to }).toString();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-teal-950">CPA Center</h1>
        <p className="mt-2 text-sm text-teal-800">
          Review recorded expenses and business mileage, then download their source
          records.
        </p>
      </header>
      <form action="/admin/cpa" method="get" className="flex flex-wrap items-end gap-3">
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
        <a className="ops-button secondary" href="/admin/cpa">
          This month
        </a>
      </form>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          {
            data: expenses,
            title: "Recorded expenses",
            value: `$${expenses.total}`,
            path: "/admin/expenses",
            exportLabel: "Export expenses CSV",
          },
          {
            data: mileage,
            title: "Recorded mileage",
            value: `${mileage.total} miles`,
            path: "/admin/mileage",
            exportLabel: "Export mileage CSV",
          },
        ].map(({ data, title, value, path, exportLabel }) => (
          <section
            key={data.kind}
            aria-label={title}
            className="min-w-0 space-y-3 rounded-xl border border-teal-100 bg-white p-5"
          >
            <h2 className="text-lg font-semibold">{title}</h2>
            <a
              href={`${path}?${query}`}
              className="block text-3xl font-semibold break-words text-teal-950 underline decoration-teal-200 underline-offset-4"
            >
              {value}
            </a>
            <p className="text-sm">
              {data.count} saved {data.kind === "expense" ? "expenses" : "trips"} in this
              period
            </p>
            {data.count === 0 && (
              <p className="text-sm text-slate-600">No records for these dates.</p>
            )}
            <p className="text-xs text-slate-600">
              {data.kind === "expense"
                ? "USD total only. Other currencies remain in the source records and export."
                : "Recorded miles only. No mileage reimbursement or deduction rate is applied."}
            </p>
            <div className="flex flex-wrap gap-2">
              <a className="ops-button secondary" href={`${path}?${query}`}>
                Review records
              </a>
              <a
                className="ops-button secondary"
                href={`/api/admin/finance?kind=${data.kind}&format=csv&${query}`}
              >
                {exportLabel}
              </a>
            </div>
          </section>
        ))}
      </div>
      <section
        aria-label="Review scope"
        className="space-y-2 rounded-xl border border-teal-100 bg-white p-5 text-sm"
      >
        <h2 className="text-lg font-semibold">Review scope</h2>
        <p>
          These totals cover saved records for the selected dates. They do not determine
          tax deductibility or profit.
        </p>
        <p>
          Expenses use their recorded expense date. Mileage uses the Chicago business
          date. Exports include record IDs and revisions and are limited to 10,000 records
          per file.
        </p>
        <p>
          QuickBooks reconciliation, complete financial statements and tax filing reports
          are still in development.
        </p>
      </section>
    </div>
  );
}
