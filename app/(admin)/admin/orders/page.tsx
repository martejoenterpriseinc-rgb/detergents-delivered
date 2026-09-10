import Link from "next/link";
import { ZodError } from "zod";
import { requireRole } from "@/lib/authz";
import { listOrders } from "@/lib/services/order-workspace";
import { orderMoney, orderStatusLabels } from "@/lib/domain/order-workspace";
import { businessDate } from "@/lib/domain/operations";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  const parsed = await searchParams;
  let data: Awaited<ReturnType<typeof listOrders>> | undefined;
  try {
    data = await listOrders(session.user.id, parsed);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
  }
  if (!data)
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Orders</h1>
        <p>Check your order filters and try again.</p>
        <Link href="/admin/orders" className="ops-button">
          Reset filters
        </Link>
      </div>
    );
  const query = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams({
      q: data.filters.q,
      status: data.filters.status,
      view: data.filters.view,
      from: data.filters.from ?? "",
      to: data.filters.to ?? "",
      page: String(data.filters.page),
    });
    Object.entries(updates).forEach(([key, value]) => params.set(key, String(value)));
    return `/admin/orders?${params}` as const;
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-teal-950">Orders</h1>
          <p className="mt-1 text-teal-800">
            Find an order and review payment, items, and delivery progress.
          </p>
        </div>
        {data.canManage && (
          <Link href="/admin/payments" className="ops-button">
            Payment recovery
          </Link>
        )}
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="min-w-0 flex-1 basis-60">
          Search orders
          <input
            className="block w-full rounded-lg border p-2"
            name="q"
            defaultValue={data.filters.q}
            maxLength={100}
            placeholder="Order, customer, email or SKU"
          />
        </label>
        <label>
          Status
          <select
            aria-label="Order status"
            className="block rounded-lg border p-2"
            name="status"
            defaultValue={data.filters.status}
          >
            <option value="ALL">All statuses</option>
            {Object.entries(orderStatusLabels).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            className="block rounded-lg border p-2"
            type="date"
            name="from"
            defaultValue={data.filters.from}
          />
        </label>
        <label>
          Through
          <input
            className="block rounded-lg border p-2"
            type="date"
            name="to"
            defaultValue={data.filters.to}
          />
        </label>
        <input type="hidden" name="view" value={data.filters.view} />
        <button className="ops-button">Apply filters</button>
        <Link href="/admin/orders" className="underline">
          Clear
        </Link>
      </form>
      <p className="text-sm text-teal-800">
        Dates use order creation in Chicago time. Status counts include every match for
        your search and dates.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link
          href={query({ status: "ALL", view: "all", page: 1 })}
          className="rounded-xl border bg-white p-4"
        >
          <span className="block text-sm">All orders</span>
          <strong className="text-2xl">
            {Object.values(data.statusCounts).reduce((a, b) => a + b, 0)}
          </strong>
        </Link>
        <Link
          href={query({ status: "PENDING_PAYMENT", view: "all", page: 1 })}
          className="rounded-xl border bg-white p-4"
        >
          <span className="block text-sm">Awaiting payment</span>
          <strong className="text-2xl">{data.statusCounts.PENDING_PAYMENT ?? 0}</strong>
        </Link>
        <Link
          href={query({ status: "PAID", view: "all", page: 1 })}
          className="rounded-xl border bg-white p-4"
        >
          <span className="block text-sm">Paid</span>
          <strong className="text-2xl">{data.statusCounts.PAID ?? 0}</strong>
        </Link>
        <Link
          href={query({ status: "ALL", view: "review", page: 1 })}
          className="rounded-xl border bg-white p-4"
        >
          <span className="block text-sm">Payment needs review</span>
          <strong className="text-2xl">{data.reviewCount}</strong>
        </Link>
      </div>
      {data.filters.view === "review" && (
        <p className="rounded-xl bg-amber-50 p-3">
          Showing checkouts requiring payment review.{" "}
          <Link className="underline" href={query({ view: "all", page: 1 })}>
            Show all matches
          </Link>
        </p>
      )}
      <div className="space-y-3" aria-label="Order records">
        {!data.rows.length && (
          <p className="rounded-xl border bg-white p-6">No orders match these filters.</p>
        )}
        {data.rows.map((row) => (
          <article
            key={row.id}
            className="grid gap-4 rounded-xl border bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0 break-words">
              <Link
                className="text-lg font-semibold underline"
                href={`/admin/orders/${row.id}`}
              >
                {row.number}
              </Link>
              <p>{row.customer}</p>
              <p className="text-sm text-teal-800">{row.email}</p>
              <p className="mt-2 text-sm">
                {businessDate(new Date(row.createdAt))} · {row.itemLines} item{" "}
                {row.itemLines === 1 ? "line" : "lines"}
              </p>
              <p className="font-semibold">{orderStatusLabels[row.status]}</p>
              {row.review && <p className="text-amber-900">Payment needs review</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-col sm:items-end">
              <strong>{orderMoney(row.totalCents, row.currency)}</strong>
              <Link className="ops-button" href={`/admin/orders/${row.id}`}>
                View order
              </Link>
            </div>
          </article>
        ))}
      </div>
      <nav aria-label="Order pages" className="flex flex-wrap items-center gap-4">
        {data.filters.page > 1 && (
          <Link href={query({ page: data.filters.page - 1 })}>Previous</Link>
        )}
        <span>
          Page {data.filters.page} · {data.rows.length} shown of {data.count}
        </span>
        {data.filters.page * 50 < data.count && (
          <Link href={query({ page: data.filters.page + 1 })}>Next</Link>
        )}
      </nav>
    </div>
  );
}
