"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { readFinance } from "@/lib/services/finance";
type Data = Awaited<ReturnType<typeof readFinance>>;
type Row = Data["rows"][number];
const inputClass = "block w-full rounded-lg border p-2";
export function FinanceWorkspace({ data }: { data: Data }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pending = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
  const expense = data.kind === "expense",
    title = expense ? "Expenses" : "Mileage";
  const path = expense ? "/admin/expenses" : "/admin/mileage";
  const query = (page: number) =>
    new URLSearchParams({
      from: data.filters.from,
      to: data.filters.to,
      page: String(page),
    }).toString();
  function open(row: Row | null) {
    pending.current = null;
    setEditing(row);
    setError("");
    setNotice("");
  }
  async function save(form: FormData) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const fields: Record<string, unknown> = {
      kind: data.kind,
      version: editing?.version ?? 0,
      date: form.get("date"),
      reason: form.get("reason") ?? "",
      ...(editing ? { id: editing.id } : {}),
    };
    if (expense)
      Object.assign(fields, {
        category: form.get("category"),
        amount: form.get("amount"),
        memo: form.get("memo"),
      });
    else
      Object.assign(fields, {
        vehicleId: form.get("vehicleId"),
        startOdometer: Number(form.get("startOdometer")),
        endOdometer: Number(form.get("endOdometer")),
        purpose: form.get("purpose"),
      });
    if (
      pending.current &&
      JSON.stringify(pending.current.body) !== JSON.stringify(fields)
    ) {
      setError(
        "Retry the unchanged save or reload records to confirm the prior result before editing.",
      );
      setBusy(false);
      return;
    }
    pending.current ??= { key: crypto.randomUUID(), body: fields };
    try {
      const response = await fetch("/api/admin/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, requestKey: pending.current.key }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) pending.current = null;
        throw new Error(result.error ?? "Save could not be confirmed.");
      }
      pending.current = null;
      setEditing(undefined);
      setNotice(editing ? "Correction saved with audit history." : "Record saved.");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Save could not be confirmed. Retry the same entry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-teal-950">{title}</h1>
          <p className="mt-1 text-sm text-teal-800">
            {expense
              ? "Record operating costs and export them for accounting review."
              : "Record your business trips using whole-mile odometer readings."}
          </p>
        </div>
        {data.canWrite && editing === undefined && (
          <button className="ops-button" onClick={() => open(null)}>
            + {expense ? "Expense" : "Trip"}
          </button>
        )}
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label>
          From
          <input
            className={inputClass}
            type="date"
            name="from"
            defaultValue={data.filters.from}
            required
          />
        </label>
        <label>
          Through
          <input
            className={inputClass}
            type="date"
            name="to"
            defaultValue={data.filters.to}
            required
          />
        </label>
        <button className="ops-button" disabled={busy || editing !== undefined}>
          Apply dates
        </button>
        <a
          className="ops-button"
          href={`/api/admin/finance?kind=${data.kind}&format=csv&${query(1)}`}
        >
          Export CSV
        </a>
      </form>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-white p-5">
          <p className="text-sm text-teal-800">
            {expense ? "Recorded expenses · USD" : "Recorded distance · miles"}
          </p>
          <strong className="text-3xl">
            {expense ? "$" : ""}
            {Number(data.total).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </strong>
        </div>
        <div className="rounded-xl border bg-white p-5">
          <p className="text-sm text-teal-800">Records in date range</p>
          <strong className="text-3xl">{data.count}</strong>
        </div>
      </div>
      <p className="text-sm text-teal-800">
        {expense
          ? "Totals cover recorded USD expenses, not profit or deductible amounts. Other currencies are listed separately."
          : "Distance is recorded mileage, not a tax deduction. Trip dates do not represent exact departure or arrival times."}
      </p>
      {error && (
        <p
          role="alert"
          aria-label="Save error"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-teal-50 p-3">
          {notice}
        </p>
      )}
      {editing !== undefined && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(new FormData(event.currentTarget));
          }}
          className="space-y-4 rounded-xl border bg-white p-5"
          key={editing?.id ?? "new"}
        >
          <h2 className="text-xl font-semibold">
            {editing ? "Correct record" : expense ? "New expense" : "New trip"}
          </h2>
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <label>
              {expense ? "Expense date" : "Trip date"}
              <input
                className={inputClass}
                name="date"
                type="date"
                defaultValue={editing?.date ?? data.filters.to}
                required
              />
            </label>
            {expense ? (
              <>
                <label>
                  Category
                  <input
                    className={inputClass}
                    name="category"
                    list="expense-categories"
                    defaultValue={editing?.label ?? ""}
                    maxLength={100}
                    required
                  />
                  <datalist id="expense-categories">
                    {data.categories.map((c) => (
                      <option key={c.name} value={c.name} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Amount (USD)
                  <input
                    className={inputClass}
                    name="amount"
                    inputMode="decimal"
                    defaultValue={editing?.amount ?? ""}
                    placeholder="0.00"
                    required
                  />
                </label>
                <label>
                  Merchant / memo
                  <input
                    className={inputClass}
                    name="memo"
                    defaultValue={editing?.description ?? ""}
                    maxLength={1000}
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Vehicle
                  <select
                    className={inputClass}
                    name="vehicleId"
                    defaultValue={editing?.vehicleId ?? ""}
                    required
                  >
                    <option value="">Choose vehicle</option>
                    {data.vehicles
                      .filter((v) => !editing || v.id === editing.vehicleId)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Starting odometer
                  <input
                    className={inputClass}
                    name="startOdometer"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={editing?.startOdometer ?? ""}
                    required
                  />
                </label>
                <label>
                  Ending odometer
                  <input
                    className={inputClass}
                    name="endOdometer"
                    type="number"
                    min="1"
                    step="1"
                    defaultValue={editing?.endOdometer ?? ""}
                    required
                  />
                </label>
                <label className="sm:col-span-2">
                  Business purpose
                  <input
                    className={inputClass}
                    name="purpose"
                    defaultValue={editing?.description ?? ""}
                    maxLength={1000}
                    required
                  />
                </label>
                {!data.vehicles.length && (
                  <p>
                    Add an active vehicle in{" "}
                    <a className="underline" href="/admin/settings/launch">
                      Launch &amp; Capacity
                    </a>{" "}
                    before recording a trip.
                  </p>
                )}
              </>
            )}
            {editing && (
              <label className="sm:col-span-2">
                Reason for correction
                <input className={inputClass} name="reason" maxLength={500} required />
              </label>
            )}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button
              className="ops-button"
              disabled={busy || (!expense && !data.vehicles.length)}
            >
              {busy ? "Saving…" : "Save record"}
            </button>
            <button
              type="button"
              className="ops-button"
              disabled={busy}
              onClick={() => {
                if (pending.current) {
                  setError(
                    "The last save is unconfirmed. Retry unchanged or reload this page and check the records before starting another entry.",
                  );
                  return;
                }
                setEditing(undefined);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="space-y-3" aria-label={`${title} records`}>
        {!data.rows.length && (
          <p className="rounded-xl border bg-white p-6">
            No {expense ? "expenses" : "trips"} in this date range.
          </p>
        )}
        {data.rows.map((row) => (
          <article
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 rounded-xl border bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          >
            <div className="col-span-2 min-w-0 break-words sm:col-span-1">
              <p className="text-sm text-teal-800">
                {row.date} · {row.label}
              </p>
              <h2 className="mt-1 font-semibold">
                {row.description || "No description recorded"}
              </h2>
              {!expense && (
                <p className="text-sm">
                  Odometer: {row.startOdometer ?? "—"} → {row.endOdometer ?? "—"}
                </p>
              )}
              <p className="text-xs text-teal-700">
                {row.version
                  ? `Revision ${row.version} · audit saved`
                  : "Existing record"}
              </p>
            </div>
            <strong className="min-w-0 break-words">
              {row.currency === "USD" ? "$" : ""}
              {row.amount || "Not recorded"}
              {row.currency !== "USD" ? ` ${row.currency}` : ""}
            </strong>
            {row.editable && (
              <button
                className="ops-button justify-self-end"
                disabled={busy || editing !== undefined}
                onClick={() => open(row)}
              >
                Edit
              </button>
            )}
          </article>
        ))}
      </div>
      <nav aria-label="Records pages" className="flex flex-wrap items-center gap-4">
        {data.filters.page > 1 && (
          <a href={`${path}?${query(data.filters.page - 1)}`}>Previous</a>
        )}
        <span>
          Page {data.filters.page} · {data.rows.length} shown of {data.count}
        </span>
        {data.filters.page * 50 < data.count && (
          <a href={`${path}?${query(data.filters.page + 1)}`}>Next</a>
        )}
      </nav>
    </div>
  );
}
