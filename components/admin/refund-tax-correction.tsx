"use client";
import { useState } from "react";
export function RefundTaxCorrectionForm({
  adjustmentId,
  onMatched,
}: {
  adjustmentId: string;
  onMatched: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="space-y-3 rounded border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setMessage("");
        try {
          const r = await fetch("/api/admin/taxes/refund-corrections", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              adjustmentId,
              correctionTaxTransactionId: f.get("transaction"),
              confirmed: f.get("confirmed") === "on",
            }),
          });
          const v = await r.json();
          if (!r.ok) throw Error(v.error ?? "Tax correction was not verified.");
          setMessage(
            "Tax correction verified. Reload the source to prepare its accounting correction.",
          );
          onMatched();
        } catch (err) {
          setMessage(
            err instanceof Error ? err.message : "Tax correction could not be checked.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Verify the Stripe Tax adjustment that restores this failed refund’s tax. The
        original sale and refund remain recorded.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">
          Existing correction transaction ID
          <input
            name="transaction"
            required
            pattern="tax_[A-Za-z0-9]+"
            maxLength={100}
            className="mt-1 block w-full rounded border p-3"
          />
        </label>
        <label className="flex gap-2">
          <input type="checkbox" name="confirmed" required />I reviewed the failed refund
          and this correcting tax transaction.
        </label>
        <button className="ops-button">Verify tax correction</button>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
