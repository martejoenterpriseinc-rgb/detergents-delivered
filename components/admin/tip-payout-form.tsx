"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
export function TipPayoutForm({
  tipId,
  transfers,
}: {
  tipId: string;
  transfers: { id: string; reference: string; amountCents: number }[];
}) {
  const router = useRouter();
  const pending = useRef<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save(form: FormData) {
    setBusy(true);
    setMessage("");
    try {
      if (!pending.current) {
        const amount = String(form.get("amount"));
        if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(amount))
          throw Error("Enter a USD amount with at most two decimal places.");
        const [dollars, cents = ""] = amount.split(".");
        pending.current = JSON.stringify({
          tipId,
          requestKey: crypto.randomUUID(),
          amountCents: Number(dollars) * 100 + Number(cents.padEnd(2, "0")),
          reference: form.get("reference"),
          paidOn: form.get("paidOn"),
          reason: form.get("reason"),
          confirmed: form.get("confirmed") === "on",
          ...(form.get("reversalOfId") ? { reversalOfId: form.get("reversalOfId") } : {}),
        });
      }
      const r = await fetch("/api/admin/tips/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: pending.current,
      });
      if (r.status >= 400 && r.status < 500) pending.current = null;
      const result = await r.json();
      if (!r.ok)
        throw Error(
          result.error ??
            "Transfer record could not be confirmed. Retry the same request.",
        );
      pending.current = null;
      setMessage("Transfer record saved.");
      router.refresh();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Save could not be confirmed. Retry the same request.",
      );
    } finally {
      setUncertain(pending.current !== null);
      setBusy(false);
    }
  }
  return (
    <form
      className="space-y-4 rounded-xl border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save(new FormData(e.currentTarget));
      }}
    >
      <h2 className="text-xl font-semibold">Record a completed driver transfer</h2>
      <p>
        This records money already transferred. It does not send money. For a reversal,
        confirm the original transfer failed or the driver returned the funds.
      </p>
      <fieldset disabled={busy || uncertain} className="grid gap-4 sm:grid-cols-2">
        <label>
          Entry type
          <select name="reversalOfId" className="block w-full rounded-lg border p-3">
            <option value="">Driver payment</option>
            {transfers.map((t) => (
              <option key={t.id} value={t.id}>
                Reverse {t.reference} (${(t.amountCents / 100).toFixed(2)})
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount (USD)
          <input
            name="amount"
            inputMode="decimal"
            required
            className="block w-full rounded-lg border p-3"
          />
        </label>
        <label>
          Transfer date
          <input
            name="paidOn"
            type="date"
            required
            className="block w-full rounded-lg border p-3"
          />
        </label>
        <label>
          Bank or cash receipt reference
          <input
            name="reference"
            minLength={5}
            maxLength={160}
            required
            className="block w-full rounded-lg border p-3"
          />
        </label>
        <label className="sm:col-span-2">
          Reason or evidence notes
          <textarea
            name="reason"
            minLength={5}
            maxLength={500}
            required
            className="block w-full rounded-lg border p-3"
          />
        </label>
        <label className="sm:col-span-2">
          <input type="checkbox" name="confirmed" required /> I verified the completed
          transfer or returned funds against the receipt.
        </label>
      </fieldset>
      <button disabled={busy} className="ops-button">
        {busy
          ? "Saving…"
          : uncertain
            ? "Retry same transfer record"
            : "Save transfer record"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
