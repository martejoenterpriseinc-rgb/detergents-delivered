"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { readManualCheckouts } from "@/lib/services/manual-checkout";
type Row = Awaited<ReturnType<typeof readManualCheckouts>>["rows"][number];
export function ManualSettlementRow({ row, canWrite }: { row: Row; canWrite: boolean }) {
  const router = useRouter(),
    pending = useRef<string | null>(null),
    pendingMethod = useRef<string | null>(null);
  const [busy, setBusy] = useState(false),
    [operation, setOperation] = useState(
      row.settlement?.state === "REVIEW" ? "APPROVE" : "RECONCILE",
    ),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState("");
  async function save(form: FormData) {
    setBusy(true);
    setMessage("");
    try {
      if (!pending.current) {
        pendingMethod.current = row.settlement
          ? operation === "RECONCILE"
            ? "PATCH"
            : "PUT"
          : "POST";
        pending.current = JSON.stringify(
          row.settlement
            ? operation !== "RECONCILE"
              ? {
                  id: row.settlement.id,
                  requestKey: crypto.randomUUID(),
                  action: operation,
                  reason: form.get("reason"),
                  confirmed: form.get("confirmed") === "on",
                  ...(operation === "RETURN"
                    ? { reference: form.get("returnReference") }
                    : {}),
                  ...(operation === "RESCHEDULE"
                    ? { serviceDate: form.get("serviceDate") }
                    : {}),
                }
              : {
                  id: row.settlement.id,
                  ...(form.get("taxTransactionId")
                    ? { taxTransactionId: form.get("taxTransactionId") }
                    : {}),
                }
            : {
                checkoutId: row.id,
                requestKey: crypto.randomUUID(),
                amountCents: Math.round(Number(form.get("amount")) * 100),
                reference: form.get("reference"),
                reason: form.get("reason"),
                receivedAt: form.get("receivedAt")
                  ? new Date(String(form.get("receivedAt"))).toISOString()
                  : new Date().toISOString(),
                confirmed: form.get("confirmed") === "on",
              },
        );
      }
      const response = await fetch("/api/admin/manual-settlements", {
        method: pendingMethod.current!,
        headers: { "Content-Type": "application/json" },
        body: pending.current,
      });
      if (response.status >= 400 && response.status < 500) pending.current = null;
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Settlement needs review.");
      pending.current = null;
      setMessage(
        row.settlement
          ? operation === "RECONCILE"
            ? "Settlement confirmed."
            : "Review action recorded."
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
      {canWrite && !["SETTLED", "RETURNED"].includes(row.settlement?.state ?? "") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <fieldset disabled={busy || uncertain} className="space-y-3">
            {row.settlement ? (
              <>
                <label className="block">
                  Action
                  <select
                    className="mt-1 block w-full rounded-lg border p-3"
                    value={operation}
                    onChange={(e) => setOperation(e.target.value)}
                  >
                    <option value="RECONCILE">Verify tax and settle</option>
                    <option value="APPROVE">Approve received-funds review</option>
                    <option value="RESCHEDULE">Reschedule agreed delivery</option>
                    <option value="RETURN">Record funds already returned</option>
                  </select>
                </label>
                {operation === "RECONCILE" ? (
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
                    {operation === "RESCHEDULE" && (
                      <label className="block">
                        Agreed delivery date
                        <input
                          type="date"
                          name="serviceDate"
                          required
                          className="mt-1 block w-full rounded-lg border p-3"
                        />
                      </label>
                    )}
                    {operation === "RETURN" && (
                      <label className="block">
                        Bank/cash return reference
                        <input
                          name="returnReference"
                          required
                          minLength={5}
                          maxLength={160}
                          className="mt-1 block w-full rounded-lg border p-3"
                        />
                      </label>
                    )}
                    <label className="block">
                      Review notes
                      <textarea
                        name="reason"
                        required
                        minLength={5}
                        maxLength={500}
                        className="mt-1 block w-full rounded-lg border p-3"
                      />
                    </label>
                    <label className="flex gap-2">
                      <input name="confirmed" type="checkbox" required />
                      {operation === "RETURN"
                        ? "I verified the full recorded amount was returned to the original payer using the original payment method."
                        : operation === "RESCHEDULE"
                          ? "The customer agreed to this delivery date."
                          : "I reviewed the received funds and current payment approval."}
                    </label>
                  </>
                )}
              </>
            ) : (
              <>
                <label className="block">
                  Amount received ($)
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max="10000"
                    step="0.01"
                    required
                    defaultValue={
                      row.amountCents === null
                        ? undefined
                        : (row.amountCents / 100).toFixed(2)
                    }
                    className="mt-1 block w-full rounded-lg border p-3"
                  />
                </label>
                <label className="block">
                  Received at (your local time; blank means now)
                  <input
                    name="receivedAt"
                    type="datetime-local"
                    className="mt-1 block w-full rounded-lg border p-3"
                  />
                </label>
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
                  the entered amount. This records received money; it does not request
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
                  ? operation === "RECONCILE"
                    ? "Verify tax and settle"
                    : "Save review action"
                  : "Record received payment"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {row.orderId && row.settlement?.state === "SETTLED" && (
        <Link className="ops-button" href={`/admin/payments/manual/${row.orderId}`}>
          Refunds / return receipts
        </Link>
      )}
      {row.settlement?.lastError && (
        <p role="alert">
          Tax or delivery reconciliation is required. Do not collect again.
        </p>
      )}
    </article>
  );
}
