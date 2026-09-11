"use client";
import { useState } from "react";
import type { listQuickbooksReceiptDrafts } from "@/lib/services/quickbooks-receipt-drafts";
type Data = Awaited<ReturnType<typeof listQuickbooksReceiptDrafts>>;
async function response(init?: RequestInit, query = "") {
  const r = await fetch("/api/admin/quickbooks/receipts" + query, init),
    v = await r.json();
  if (!r.ok) throw new Error(v.error ?? "Receipt drafts could not be updated.");
  return v;
}
const post = (body: unknown) =>
  response({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export function PrepareReceiptDraft({
  orderId,
  adjustmentId,
}: {
  orderId: string;
  adjustmentId?: string;
}) {
  const [confirmed, setConfirmed] = useState(false),
    [requestKey, setRequestKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  async function prepare() {
    if (!confirmed) return;
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    setBusy(true);
    setError("");
    try {
      const result = await post({
        action: "prepare",
        requestKey: key,
        orderId,
        ...(adjustmentId ? { adjustmentId } : {}),
        confirmed: true,
      });
      setSaved(result.docNumber);
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receipt draft could not be prepared.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 border-t pt-4">
      <p>A draft preserves the original amounts and company mappings for review.</p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy || !!saved}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I reviewed this source for a receipt draft.
      </label>
      <button
        className="ops-button"
        disabled={busy || !confirmed || !!saved}
        onClick={prepare}
      >
        Prepare receipt draft
      </button>
      {saved && (
        <p role="status">
          Receipt draft {saved} saved. Load receipt exports below to review it.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function QuickbooksReceipts() {
  const [data, setData] = useState<Data | null>(null),
    [held, setHeld] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(""),
    [error, setError] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receipt drafts could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  async function load(more = false) {
    await run(async () => {
      const result: Data = await response(
        undefined,
        more && data?.nextCursor ? "?cursor=" + encodeURIComponent(data.nextCursor) : "",
      );
      setData((old) =>
        more && old
          ? {
              ...result,
              rows: [
                ...old.rows,
                ...result.rows.filter((r) => !old.rows.some((p) => p.id === r.id)),
              ],
            }
          : result,
      );
      setConfirmed("");
      if (!more) setHeld([]);
    });
  }
  const money = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      v / 100,
    );
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Receipt exports</h2>
      <p>
        Review prepared sale and cash-refund receipts. Only unsent drafts can be canceled
        here.
      </p>
      <button className="ops-button" disabled={busy} onClick={() => load()}>
        Load receipt exports
      </button>
      {data && (
        <>
          <p>
            New receipt submissions:{" "}
            {data.canSubmit ? "enabled for this company" : "disabled"}.
          </p>
          {!data.rows.length && <p>No receipt drafts are saved for this company.</p>}
          {data.rows.map((r) => (
            <article key={r.id} className="space-y-3 rounded border p-4">
              <h3 className="font-semibold">
                {r.number} ·{" "}
                {r.entity === "SalesReceipt" ? "Sale receipt" : "Refund receipt"}
              </h3>
              <p>
                {r.date} · {money(r.cashCents)} · {r.status.toLowerCase()}
              </p>
              <p>
                Reference {r.docNumber} · Company {r.realm}
              </p>
              <p>
                {r.customerName} · {r.clearingAccount}
              </p>
              {r.externalId && <p>QuickBooks receipt {r.externalId}</p>}
              {r.reconciliationIssue && (
                <p role="alert">
                  {r.reconciliationIssue === "REFUND_COMPENSATION_REVIEW"
                    ? "This refund was later reversed. Its accounting adjustment needs review."
                    : "Provider receipt evidence has not been confirmed."}
                </p>
              )}
              {held.includes(r.id) && r.status === "DRAFT" && (
                <p>Reload receipt exports to check the submission state.</p>
              )}
              {data.canWrite && r.status === "DRAFT" && (
                <>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      disabled={busy || held.includes(r.id)}
                      checked={confirmed === r.id}
                      onChange={(e) => setConfirmed(e.target.checked ? r.id : "")}
                    />
                    Cancel this unsent receipt draft.
                  </label>
                  <button
                    className="ops-button"
                    disabled={busy || confirmed !== r.id || held.includes(r.id)}
                    onClick={() =>
                      run(async () => {
                        await post({ action: "cancel", id: r.id, confirmed: true });
                        setData({
                          ...data,
                          rows: data.rows.map((p) =>
                            p.id === r.id ? { ...p, status: "CANCELED" } : p,
                          ),
                        });
                        setConfirmed("");
                      })
                    }
                  >
                    Cancel receipt draft
                  </button>
                  {data.canSubmit && (
                    <>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          disabled={busy || held.includes(r.id)}
                          checked={confirmed === "submit:" + r.id}
                          onChange={(e) =>
                            setConfirmed(e.target.checked ? "submit:" + r.id : "")
                          }
                        />
                        Submit this receipt to QuickBooks.
                      </label>
                      <button
                        className="ops-button"
                        disabled={
                          busy || held.includes(r.id) || confirmed !== "submit:" + r.id
                        }
                        onClick={() =>
                          run(async () => {
                            setHeld((old) => [...new Set([...old, r.id])]);
                            const result = await post({
                              action: "submit",
                              id: r.id,
                              confirmed: true,
                            });
                            setData({
                              ...data,
                              rows: data.rows.map((p) => (p.id === r.id ? result : p)),
                            });
                            setConfirmed("");
                          })
                        }
                      >
                        Submit receipt once
                      </button>
                    </>
                  )}
                </>
              )}
              {data.canWrite &&
                ["SUBMITTING", "UNKNOWN", "POSTED"].includes(r.status) && (
                  <button
                    className="ops-button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await post({
                          action: "reconcile",
                          id: r.id,
                          confirmed: true,
                        });
                        setData({
                          ...data,
                          rows: data.rows.map((p) => (p.id === r.id ? result : p)),
                        });
                      })
                    }
                  >
                    Check QuickBooks receipt
                  </button>
                )}
            </article>
          ))}
          {data.nextCursor && data.rows.length < 500 && (
            <button className="ops-button" disabled={busy} onClick={() => load(true)}>
              More receipt exports
            </button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
