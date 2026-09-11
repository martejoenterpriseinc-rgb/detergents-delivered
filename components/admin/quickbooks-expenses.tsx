"use client";
import { useState } from "react";
import type { listQuickbooksExpenses } from "@/lib/services/quickbooks-expenses";
type Data = Awaited<ReturnType<typeof listQuickbooksExpenses>>;
type Row = Data["rows"][number];
function ExpenseRow({
  row,
  canWrite,
  canSubmit,
  reload,
}: {
  row: Row;
  canWrite: boolean;
  canSubmit: boolean;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [paymentType, setPaymentType] = useState("Cash"),
    [error, setError] = useState(""),
    [requestKey, setRequestKey] = useState(""),
    [attemptedSubmit, setAttemptedSubmit] = useState(false);
  async function act(action: "prepare" | "submit" | "cancel" | "reconcile") {
    setBusy(true);
    setError("");
    if (action === "submit") setAttemptedSubmit(true);
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    try {
      const r = await fetch("/api/admin/quickbooks/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "prepare"
            ? { action, requestKey: key, expenseId: row.id, paymentType, confirmed: true }
            : { action, id: row.export?.id, confirmed: true },
        ),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error ?? "Export could not be confirmed.");
      setConfirmed(false);
      setRequestKey("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export could not be confirmed.");
      if (action === "submit") await reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-3 rounded border p-4">
      <h3 className="font-semibold">
        {row.date} · {row.category} · {row.currency} {(row.amountCents / 100).toFixed(2)}
      </h3>
      <p>{row.memo}</p>
      {row.export ? (
        <>
          <p>
            Export: {row.export.status.toLowerCase()} · Reference {row.export.docNumber}
          </p>
          <p>
            Company {row.export.realm} · {row.export.mapping.expenseAccount.name} · Paid
            from {row.export.mapping.paymentAccount.name}
          </p>
          {row.export.reconciliationIssue && (
            <p role="alert">
              QuickBooks evidence needs review. The saved accounting link remains
              protected.
            </p>
          )}
          {row.export.externalId && <p>QuickBooks transaction {row.export.externalId}</p>}
          {["SUBMITTING", "UNKNOWN"].includes(row.export.status) && (
            <p>Reconcile this export before taking further accounting action.</p>
          )}
        </>
      ) : row.linked ? (
        <p>This expense already has an accounting link.</p>
      ) : (
        <p>No export prepared.</p>
      )}
      {canWrite &&
        (!row.linked || Boolean(row.export?.reconciliationIssue)) &&
        row.currency === "USD" && (
          <>
            {!row.export && (
              <label className="block">
                Payment type
                <select
                  className="ml-2 rounded border p-2"
                  value={paymentType}
                  onChange={(e) => {
                    setPaymentType(e.target.value);
                    setRequestKey("");
                    setConfirmed(false);
                  }}
                >
                  <option value="Cash">Bank or cash account</option>
                  <option value="CreditCard">Credit card</option>
                </select>
              </label>
            )}
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {row.export
                ? "I reviewed this expense and its QuickBooks accounts."
                : "I authorize preparing this expense for review."}
            </label>
            <div className="flex flex-wrap gap-3">
              {!row.export && (
                <button
                  className="ops-button"
                  disabled={busy || !confirmed}
                  onClick={() => act("prepare")}
                >
                  Prepare expense export
                </button>
              )}
              {row.export?.status === "DRAFT" && (
                <>
                  <button
                    className="ops-button"
                    disabled={busy || !confirmed || !canSubmit || attemptedSubmit}
                    onClick={() => act("submit")}
                  >
                    Submit to QuickBooks
                  </button>
                  <button
                    className="ops-button"
                    disabled={busy || !confirmed}
                    onClick={() => act("cancel")}
                  >
                    Cancel export draft
                  </button>
                  {!canSubmit && <p>Posting is not enabled for this company.</p>}
                </>
              )}
              {row.export &&
                ["SUBMITTING", "UNKNOWN", "POSTED"].includes(row.export.status) && (
                  <button
                    className="ops-button"
                    disabled={busy || !confirmed}
                    onClick={() => act("reconcile")}
                  >
                    Reconcile export
                  </button>
                )}
            </div>
          </>
        )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
export function QuickbooksExpenses() {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  async function load(more = false) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        "/api/admin/quickbooks/expenses" +
          (more && data?.nextCursor
            ? "?cursor=" + encodeURIComponent(data.nextCursor)
            : ""),
      );
      const v = await r.json();
      if (!r.ok) throw new Error(v.error ?? "Expenses could not be loaded.");
      setRevision((v) => v + 1);
      setData((old) =>
        more && old
          ? {
              ...v,
              rows: [
                ...old.rows,
                ...v.rows.filter((row: Row) => !old.rows.some((o) => o.id === row.id)),
              ],
            }
          : v,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Expenses could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Expense exports</h2>
      <p>
        Prepare and review saved expenses before posting. Submitted exports stay locked
        while their result is reconciled.
      </p>
      <button className="ops-button" disabled={busy} onClick={() => load()}>
        Load expense exports
      </button>
      {data && !data.rows.length && <p>No saved expenses.</p>}
      {data?.rows.map((row) => (
        <ExpenseRow
          key={row.id + ":" + revision}
          row={row}
          canWrite={data.canWrite}
          canSubmit={data.canSubmit}
          reload={() => load()}
        />
      ))}
      {data?.nextCursor && (
        <button className="ops-button" disabled={busy} onClick={() => load(true)}>
          Load older expenses
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
