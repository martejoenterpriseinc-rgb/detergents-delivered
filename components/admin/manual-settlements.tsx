"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { readManualCheckouts } from "@/lib/services/manual-checkout";
type Row = Awaited<ReturnType<typeof readManualCheckouts>>["rows"][number];
export function ManualSettlementRow({ row, canWrite }: { row: Row; canWrite: boolean }) {
  const router = useRouter(),
    pending = useRef<string | null>(null);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState("");
  async function save(form: FormData) {
    setBusy(true);
    setMessage("");
    try {
      if (!pending.current)
        pending.current = JSON.stringify(
          row.settlement
            ? {
                id: row.settlement.id,
                ...(form.get("taxTransactionId")
                  ? { taxTransactionId: form.get("taxTransactionId") }
                  : {}),
              }
            : {
                checkoutId: row.id,
                requestKey: crypto.randomUUID(),
                amountCents: row.amountCents,
                reference: form.get("reference"),
                reason: form.get("reason"),
                receivedAt: new Date().toISOString(),
                confirmed: form.get("confirmed") === "on",
              },
        );
      const response = await fetch("/api/admin/manual-settlements", {
        method: row.settlement ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: pending.current,
      });
      if (response.status >= 400 && response.status < 500) pending.current = null;
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Settlement needs review.");
      pending.current = null;
      setMessage(
        row.settlement
          ? "Settlement confirmed."
          : "Received money recorded. Verify tax and complete settlement next; do not collect again.",
      );
      router.refresh();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Update could not be confirmed. Retry the same request.",
      );
    } finally {
      setUncertain(pending.current !== null);
      setBusy(false);
    }
  }
  return (
    <article className="space-y-3 rounded-xl border bg-white p-5">
      <h2 className="text-xl font-semibold">{row.order}</h2>
      <p>
        {row.method} · {row.state} ·{" "}
        {row.amountCents === null
          ? "Unconfirmed"
          : `$${(row.amountCents / 100).toFixed(2)}`}
      </p>
      {row.settlement && (
        <p>
          Receipt {row.settlement.reference} · Settlement {row.settlement.state}
        </p>
      )}
      {canWrite && row.state !== "EXPIRED" && row.settlement?.state !== "SETTLED" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <fieldset disabled={busy || uncertain} className="space-y-3">
            {row.settlement ? (
              <label className="block">
                Existing Stripe Tax transaction ID (recovery only)
                <input
                  name="taxTransactionId"
                  className="mt-1 block w-full rounded-lg border p-3"
                  placeholder="Leave blank for normal reconciliation"
                />
              </label>
            ) : (
              <>
                <label className="block">
                  Bank or cash receipt reference
                  <input
                    name="reference"
                    required
                    minLength={5}
                    maxLength={160}
                    className="mt-1 block w-full rounded-lg border p-3"
                  />
                </label>
                <label className="block">
                  Evidence notes
                  <textarea
                    name="reason"
                    required
                    minLength={5}
                    maxLength={500}
                    className="mt-1 block w-full rounded-lg border p-3"
                  />
                </label>
                <label className="flex gap-2">
                  <input type="checkbox" name="confirmed" required />I verified receipt of
                  the exact order total. This records received money; it does not request
                  another payment.
                </label>
              </>
            )}
          </fieldset>
          <button disabled={busy} className="ops-button">
            {busy
              ? "Working…"
              : uncertain
                ? "Retry same request"
                : row.settlement
                  ? "Verify tax and settle"
                  : "Record received payment"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {row.settlement?.lastError && (
        <p role="alert">
          Tax or delivery reconciliation is required. Do not collect again.
        </p>
      )}
    </article>
  );
}
