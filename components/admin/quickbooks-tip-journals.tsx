"use client";
import { useRef, useState } from "react";
import type { readQuickbooksTipJournals } from "@/lib/services/quickbooks-tip-journals";
import { tipAccountKeys } from "@/lib/domain/tip-journal";
type Data = Awaited<ReturnType<typeof readQuickbooksTipJournals>>;
const labels = {
  collectionBank: "Stripe clearing account",
  payoutBank: "Driver payout bank account",
  tipLiability: "Tips payable liability account",
  taxLiability: "Tip tax liability account",
  driverReceivable: "Driver recoverable asset account",
};
export function QuickbooksTipJournals({ tipId }: { tipId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ method: string; body: string } | null>(null);
  async function refresh() {
    const r = await fetch(
      "/api/admin/tips/quickbooks?tipId=" + encodeURIComponent(tipId),
    );
    const d = await r.json();
    if (!r.ok) throw Error(d.error ?? "QuickBooks is unavailable.");
    setData(d);
  }
  async function send(method: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      pending.current ??= { method, body: JSON.stringify(body) };
      const r = await fetch("/api/admin/tips/quickbooks", {
        method: pending.current.method,
        headers: { "Content-Type": "application/json" },
        body: pending.current.body,
      });
      const d = await r.json();
      if (r.status >= 400 && r.status < 500) pending.current = null;
      if (!r.ok) throw Error(d.error ?? "Accounting action is unconfirmed.");
      pending.current = null;
      setMessage("Accounting action saved.");
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Accounting action is unconfirmed.");
    } finally {
      setUncertain(pending.current !== null);
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">QuickBooks tip accounting</h2>
      <p>
        Review balanced entries for collected tips, tax, refunds, driver transfers and
        recoverable balances. Posting records accounting only; it does not transfer money.
      </p>
      <button
        className="ops-button"
        disabled={busy || uncertain}
        onClick={() => {
          void refresh().catch((e) => setMessage(e.message));
        }}
      >
        Load tip accounting
      </button>
      {message && <p role="status">{message}</p>}
      {uncertain && (
        <button
          className="ops-button"
          disabled={busy}
          onClick={() => void send("PATCH", {})}
        >
          Retry same request
        </button>
      )}
      {data?.canWrite && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void send("POST", {
              tipId,
              requestKey: crypto.randomUUID(),
              mapping: Object.fromEntries(tipAccountKeys.map((k) => [k, f.get(k)])),
              confirmed: f.get("confirmed") === "on",
            });
          }}
          className="space-y-3"
        >
          <fieldset disabled={busy || uncertain} className="grid gap-3 sm:grid-cols-2">
            {tipAccountKeys.map((k) => (
              <label className="block" key={k}>
                {labels[k]} ID
                <input
                  name={k}
                  required
                  pattern="[0-9]{1,30}"
                  defaultValue={String(
                    (
                      data.rows.find((r) => r.status === "POSTED")?.mapping as
                        Record<string, unknown> | undefined
                    )?.[k] ?? "",
                  )}
                  className="mt-1 block w-full rounded-lg border p-3"
                />
              </label>
            ))}
            <label className="flex gap-2">
              <input name="confirmed" type="checkbox" required />I reviewed these accounts
              for tip accounting.
            </label>
          </fieldset>
          <button className="ops-button" disabled={busy || uncertain}>
            Prepare adjusting entry
          </button>
        </form>
      )}
      {data?.rows.map((r) => (
        <article key={r.id} className="space-y-2 rounded-lg border p-3">
          <p>
            Entry {r.sequence} · {r.status} · {r.docNumber}
          </p>
          {r.externalId && <p>QuickBooks reference: {r.externalId}</p>}
          {r.reconciliationIssue && (
            <p role="alert">Reconcile this entry before preparing another.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Debit</th>
                  <th>Credit</th>
                </tr>
              </thead>
              <tbody>
                {(
                  r.payload as {
                    Line: {
                      Amount: number;
                      JournalEntryLineDetail: {
                        PostingType: string;
                        AccountRef: { value: string };
                      };
                    }[];
                  }
                ).Line.map((l, i) => (
                  <tr key={i}>
                    <td>{l.JournalEntryLineDetail.AccountRef.value}</td>
                    <td>
                      {l.JournalEntryLineDetail.PostingType === "Debit"
                        ? l.Amount.toFixed(2)
                        : "—"}
                    </td>
                    <td>
                      {l.JournalEntryLineDetail.PostingType === "Credit"
                        ? l.Amount.toFixed(2)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.canWrite && (
            <div className="flex flex-wrap gap-2">
              {r.status === "DRAFT" ? (
                <>
                  <button
                    className="ops-button"
                    disabled={busy || uncertain || !data.canSubmit}
                    onClick={() => void send("PATCH", { id: r.id, action: "SUBMIT" })}
                  >
                    Post reviewed entry
                  </button>
                  <button
                    className="ops-button"
                    disabled={busy || uncertain}
                    onClick={() => void send("PATCH", { id: r.id, action: "CANCEL" })}
                  >
                    Cancel unused draft
                  </button>
                </>
              ) : (
                r.status !== "CANCELED" && (
                  <button
                    className="ops-button"
                    disabled={busy || uncertain}
                    onClick={() => void send("PATCH", { id: r.id, action: "RECONCILE" })}
                  >
                    Reconcile with QuickBooks
                  </button>
                )
              )}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
