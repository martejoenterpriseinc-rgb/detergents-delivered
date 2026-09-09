"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Gift,
  Headphones,
  UserPlus,
  Search,
  Download,
  Pencil,
  MapPin,
} from "lucide-react";
import type { customerDirectory } from "@/lib/services/operations";
import { type CustomerRow, money } from "@/lib/domain/operations";
import { exportCsv } from "@/lib/domain/operations-export";
import { AreaMap } from "./area-map";
import { Kpi, OperationsHeading } from "./operations-ui";
export function CustomerDirectory({
  data,
  supportCount,
}: {
  data: Awaited<ReturnType<typeof customerDirectory>>;
  supportCount?: number;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<CustomerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save(form: FormData) {
    if (!edit) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/operations/customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: edit.id,
          updatedAt: edit.updatedAt,
          firstName: form.get("firstName"),
          lastName: form.get("lastName"),
          phone: form.get("phone"),
        }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error ?? "Customer could not be saved.");
      setEdit(null);
      setMessage("Customer details saved.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  const pageLink = (page: number) =>
    "/admin/customers?" +
    new URLSearchParams({ ...data.filter, page: String(page) }).toString();
  return (
    <div className="ops-page">
      <OperationsHeading
        eyebrow="CUSTOMER RELATIONSHIPS"
        title="Your neighborhood, connected."
        subtitle="See where your customers are and get to know your growing community."
        date={data.filter.date}
      />
      <section className="ops-panel">
        <div className="ops-section-title">
          <div>
            <h2>Customer locations</h2>
            <p>{data.matching} customers in this view · Saved address coordinates</p>
          </div>
          <span className="ops-map-count">
            <MapPin size={16} />
            {data.pins.filter((p) => p.lat !== null && p.lng !== null).length} pinned
          </span>
        </div>
        <AreaMap
          label="Customer locations map"
          pins={data.pins.map((p) => ({
            ...p,
            color: p.referrer ? "#ba8122" : "#087b74",
          }))}
        />
        <div className="ops-map-footer">
          <span>
            <i className="teal" />
            Customer
          </span>
          <span>
            <i className="amber" />
            Referred customer
          </span>
          <p>Customers without saved coordinates remain in the list.</p>
        </div>
      </section>
      <div className="ops-kpi-grid two">
        <Kpi
          label="Customer count"
          value={data.total}
          detail="All active customer accounts"
          href="/admin/customers"
          icon={<Users size={21} />}
        />
        <Kpi
          label="Referred customer count"
          value={data.referred}
          detail="View customers and who referred them"
          href="/admin/customers?group=referred"
          icon={<Gift size={21} />}
        />
        <Kpi
          label="New customers"
          value={data.newCustomers}
          detail="Signed up this month"
          href={`/admin/customers?group=new&date=${data.filter.date}`}
          icon={<UserPlus size={21} />}
        />
        {supportCount !== undefined && (
          <Kpi
            label="Support tickets"
            value={supportCount}
            detail="Open the active support queue"
            href="/admin/support?status=ACTIVE"
            icon={<Headphones size={21} />}
          />
        )}
      </div>
      <section className="ops-panel">
        <div className="ops-section-title">
          <div>
            <h2>
              {data.filter.group === "referred"
                ? "Referred customers"
                : data.filter.group === "new"
                  ? "New customers · month to date"
                  : "All customers"}
            </h2>
            <p>{data.matching} matching customers</p>
          </div>
          <button
            className="ops-button secondary"
            onClick={() =>
              exportCsv("customers-page-" + data.filter.page, [
                [
                  "Customer",
                  "Email",
                  "City",
                  "Signup date",
                  "Total orders",
                  "Revenue cents",
                  "Referred by",
                ],
                ...data.rows.map((r) => [
                  r.name,
                  r.email,
                  r.city,
                  r.createdAt,
                  String(r.totalOrders),
                  String(r.revenueCents),
                  r.referrer ?? "",
                ]),
              ])
            }
          >
            <Download size={15} />
            Export this page
          </button>
        </div>
        {message && (
          <p role="status" className="ops-success">
            {message}
          </p>
        )}
        <form action="/admin/customers" className="ops-toolbar queue-filters">
          <label className="ops-search">
            <Search size={16} />
            <input
              name="q"
              aria-label="Search customers"
              placeholder="Search name, email, city or referrer"
              defaultValue={data.filter.q}
            />
          </label>
          <select
            name="group"
            aria-label="Customer group"
            defaultValue={data.filter.group}
          >
            <option value="all">All customers</option>
            <option value="new">New this month</option>
            <option value="referred">Referred customers</option>
          </select>
          <select name="city" aria-label="Customer city" defaultValue={data.filter.city}>
            <option value="">All cities</option>
            {data.cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select name="sort" aria-label="Sort customers" defaultValue={data.filter.sort}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
            <option value="orders">Most orders</option>
            <option value="revenue">Highest revenue</option>
          </select>
          <input type="hidden" name="date" value={data.filter.date} />
          <button className="ops-button secondary">Apply filters</button>
        </form>
        <div className="ops-table-wrap">
          <table className="ops-table customer-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Location</th>
                <th>Date signed up</th>
                <th>Total orders</th>
                <th>Total revenue</th>
                <th>Referred by</th>
                <th>
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="ops-customer-cell">
                      <span className="ops-avatar">
                        {c.name
                          .split(" ")
                          .map((p) => p[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <div>
                        <strong>{c.name}</strong>
                        <small>{c.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>{c.city || "Not saved"}</td>
                  <td>
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: "America/Chicago",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }).format(new Date(c.createdAt))}
                  </td>
                  <td>{c.totalOrders}</td>
                  <td className="ops-money">{money(c.revenueCents)}</td>
                  <td>
                    {c.referrer ? (
                      <span className="ops-referral">
                        <Gift size={13} />
                        {c.referrer}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <button
                      className="ops-edit"
                      aria-label={`Edit ${c.name}`}
                      onClick={() => {
                        setError("");
                        setEdit(c);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.rows.length && (
            <p className="ops-empty">No customers match these filters.</p>
          )}
        </div>
        <div className="ops-table-footer">
          <span>
            Page {data.filter.page} · {data.rows.length} of {data.matching} matching
            customers
          </span>
          <div>
            {data.filter.page > 1 && (
              <Link href={pageLink(data.filter.page - 1) as "/admin/customers"}>
                Previous
              </Link>
            )}
            {data.filter.page * 25 < data.matching && (
              <Link href={pageLink(data.filter.page + 1) as "/admin/customers"}>
                Next
              </Link>
            )}
          </div>
        </div>
      </section>
      <p className="ops-footnote">
        Revenue includes tax and subtracts recorded refunds. Order counts include
        non-draft orders. Edits update contact details; login email and validated delivery
        addresses retain their separate verification rules.
      </p>
      {edit && (
        <div
          className="ops-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-heading"
        >
          <form className="ops-modal-card ops-form" action={save}>
            <h2 id="edit-heading">Edit customer information</h2>
            <p>{edit.email}</p>
            <label>
              First name
              <input
                name="firstName"
                required
                maxLength={80}
                defaultValue={edit.firstName}
              />
            </label>
            <label>
              Last name
              <input name="lastName" maxLength={80} defaultValue={edit.lastName} />
            </label>
            <label>
              Phone
              <input name="phone" type="tel" maxLength={30} defaultValue={edit.phone} />
            </label>
            {error && (
              <p role="alert" className="ops-error">
                {error}
              </p>
            )}
            <div className="ops-heading-actions">
              <button
                type="button"
                className="ops-button secondary"
                disabled={busy}
                onClick={() => setEdit(null)}
              >
                Cancel
              </button>
              <button className="ops-button" disabled={busy}>
                {busy ? "Saving…" : "Save customer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
