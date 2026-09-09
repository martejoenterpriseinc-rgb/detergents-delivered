"use client";
import { useState } from "react";
import { Download, Search } from "lucide-react";
import { money } from "@/lib/domain/operations";
import { OperationsHeading } from "./operations-ui";
import { exportCsv } from "@/lib/domain/operations-export";
export function RevenueTable({
  title,
  subtitle,
  date,
  path,
  hidden = {},
  rows,
}: {
  title: string;
  subtitle: string;
  date: string;
  path: string;
  hidden?: Record<string, string>;
  rows: {
    id: string;
    number: string;
    customer: string;
    placedAt: string;
    status: string;
    revenueCents: number;
  }[];
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("newest");
  const filtered = rows
    .filter((r) =>
      [r.number, r.customer, r.status].join(" ").toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "revenue"
        ? b.revenueCents - a.revenueCents
        : sort === "customer"
          ? a.customer.localeCompare(b.customer)
          : b.placedAt.localeCompare(a.placedAt),
    );
  return (
    <div className="ops-page">
      <OperationsHeading
        eyebrow="REVENUE DETAILS"
        title={title}
        subtitle={subtitle}
        date={date}
      />
      <section className="ops-panel">
        <div className="ops-section-title">
          <div>
            <p>Matching order totals</p>
            <h2>{money(filtered.reduce((n, r) => n + r.revenueCents, 0))}</h2>
          </div>
          <span>{filtered.length} orders</span>
        </div>
        <div className="ops-toolbar queue-filters">
          <form action={path} className="ops-date">
            {Object.entries(hidden).map(([k, v]) => (
              <input key={k} name={k} type="hidden" value={v} />
            ))}
            <input aria-label="Report date" name="date" type="date" defaultValue={date} />
            <button>View</button>
          </form>
          <label className="ops-search">
            <Search size={16} />
            <input
              aria-label="Search revenue orders"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search customer or order"
            />
          </label>
          <select
            aria-label="Sort revenue orders"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="revenue">Highest revenue</option>
            <option value="customer">Customer A–Z</option>
          </select>
          <button
            className="ops-button secondary"
            onClick={() =>
              exportCsv(`revenue-${date}`, [
                ["Order", "Customer", "Date", "Status", "Revenue cents"],
                ...filtered.map((r) => [
                  r.number,
                  r.customer,
                  r.placedAt,
                  r.status,
                  String(r.revenueCents),
                ]),
              ])
            }
          >
            <Download size={15} />
            Export
          </button>
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Status</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.number}</td>
                  <td>{r.customer}</td>
                  <td>{r.placedAt.slice(0, 10)}</td>
                  <td>{r.status.replaceAll("_", " ")}</td>
                  <td>{money(r.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <p className="ops-empty">No matching paid orders.</p>}
        </div>
      </section>
    </div>
  );
}
