import { requireRole } from "@/lib/authz";
import { readTipReport } from "@/lib/services/tip-report";
const money = (n: number | null) =>
  n === null
    ? "Unconfirmed"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
        n / 100,
      );
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const s = await requireRole("ADMIN", "SUPER_ADMIN", "CPA"),
    data = await readTipReport(s.user.id, await searchParams);
  return (
    <div className="max-w-4xl space-y-5">
      <h1 className="text-3xl font-semibold">Delivery tips</h1>
      <p>
        Gross confirmed tip receipts, separate from merchandise sales, rewards and order
        refunds. These totals do not establish driver payouts, net bank deposits or tax
        filing amounts.
      </p>
      <form className="flex flex-wrap gap-3">
        <label>
          From
          <input
            type="date"
            name="from"
            defaultValue={data.filter.from}
            className="block rounded-lg border p-3"
          />
        </label>
        <label>
          Through
          <input
            type="date"
            name="to"
            defaultValue={data.filter.to}
            className="block rounded-lg border p-3"
          />
        </label>
        <button className="ops-button">Update report</button>
      </form>
      <p>
        Confirmed tips: {money(data.totals.tipCents)} · Tip tax:{" "}
        {money(data.totals.taxCents)} · Collected: {money(data.totals.totalCents)}
      </p>
      {data.totals.review > 0 && (
        <p role="alert">
          {data.totals.review} payment records need reconciliation and are excluded from
          totals.
        </p>
      )}
      <p>
        {data.rows.length} records · {data.mode} environment
      </p>
      {!data.rows.length && <p>No tips in this date range.</p>}
      {data.rows.map((r) => (
        <article key={r.id} className="space-y-2 rounded-xl border p-4">
          <h2 className="font-semibold break-all">{r.order}</h2>
          <p>
            {r.date.slice(0, 10)} · {r.state}
          </p>
          <p>
            Tip {money(r.tipCents)} · Tax {money(r.taxCents)} · Total{" "}
            {money(r.totalCents)}
          </p>
          <p className="text-sm break-all">Assigned driver record: {r.driverUserId}</p>
        </article>
      ))}
    </div>
  );
}
