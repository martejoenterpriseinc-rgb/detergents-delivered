"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function TipRefundTaxForm({
  tipId,
  refunds,
}: {
  tipId: string;
  refunds: { id: string; state: string; amountCents: number }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const succeeded = refunds.filter((r) => r.state === "succeeded");
  if (!succeeded.length) return null;
  return (
    <form
      className="space-y-4 rounded-xl border p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const value = String(data.get("tax") ?? "");
        if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(value)) {
          setMessage("Enter the refunded tax with at most two decimal places.");
          return;
        }
        const [whole, fraction = ""] = value.split(".");
        setBusy(true);
        setMessage("");
        try {
          const response = await fetch("/api/admin/tips/refund-tax", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tipId,
              providerRefundId: data.get("refund"),
              reportRunId: data.get("report"),
              taxCents: Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
              confirmed: data.get("confirmed") === "on",
            }),
          });
          const result = await response.json();
          if (!response.ok)
            throw Error(result.error ?? "Tax evidence could not be matched.");
          setMessage("Tax report matched. Tip and tax allocation saved.");
          router.refresh();
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Tax evidence could not be matched. Retry the same refund to check again.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-xl font-semibold">Match refunded tip tax</h2>
      <p>
        Choose a completed refund and the completed Stripe itemized tax report containing
        its original payment and reversal. Enter the refunded tax shown in that report.
        Saving verifies the report; it does not issue a refund or change tax at Stripe.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">
          Completed refund
          <select name="refund" required className="mt-1 block w-full rounded border p-3">
            {succeeded.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} · ${(r.amountCents / 100).toFixed(2)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Stripe report run ID
          <input
            name="report"
            required
            pattern="frr_[A-Za-z0-9]+"
            maxLength={100}
            placeholder="frr_…"
            className="mt-1 block w-full rounded border p-3"
          />
        </label>
        <label className="block">
          Refunded tax ($)
          <input
            name="tax"
            required
            inputMode="decimal"
            placeholder="0.00"
            className="mt-1 block w-full rounded border p-3"
          />
        </label>
        <label className="flex gap-2">
          <input type="checkbox" name="confirmed" required />I reviewed the refund and its
          tax report.
        </label>
        <button className="ops-button" type="submit">
          {busy ? "Checking report…" : "Verify tax allocation"}
        </button>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

export function TipTaxCorrectionForm({
  tipId,
  refundId,
}: {
  tipId: string;
  refundId: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <form
      className="space-y-3 rounded border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        try {
          const r = await fetch("/api/admin/tips/refund-tax", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tipId,
              providerRefundId: refundId,
              correctionTaxTransactionId: f.get("id"),
              confirmed: f.get("confirmed") === "on",
            }),
          });
          const v = await r.json();
          if (!r.ok) throw Error(v.error ?? "Tax correction requires review.");
          setMessage("Tax correction verified.");
          router.refresh();
        } catch (e) {
          setMessage(e instanceof Error ? e.message : "Tax correction needs review.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Failed tip refund {refundId}: verify its existing positive tax adjustment before
        restoring the accounting tax balance.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">
          Correction tax transaction ID
          <input
            name="id"
            required
            pattern="tax_[A-Za-z0-9]+"
            maxLength={100}
            className="mt-1 block w-full rounded border p-3"
          />
        </label>
        <label className="flex gap-2">
          <input type="checkbox" name="confirmed" required />I reviewed this failed refund
          and tax correction.
        </label>
        <button className="ops-button">Verify tip tax correction</button>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
