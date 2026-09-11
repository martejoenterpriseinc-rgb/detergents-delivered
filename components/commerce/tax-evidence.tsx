"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function TaxEvidence({ adjustmentId }: { adjustmentId: string }) {
  const router = useRouter();
  const [reportRunId, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="grid w-full gap-2 border-t pt-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          const response = await fetch("/api/admin/taxes/refund-evidence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adjustmentId, reportRunId, confirmed: true }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Tax report matching failed.");
          setMessage("Stripe tax report matched.");
          router.refresh();
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Tax report matching could not be confirmed. Retry the same report.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="grid gap-1 text-sm">
        Completed Stripe tax report ID
        <input
          className="w-full min-w-0 rounded border p-2"
          value={reportRunId}
          onChange={(e) => setReport(e.target.value)}
          pattern="frr_[A-Za-z0-9]+"
          maxLength={100}
          required
          disabled={busy}
        />
      </label>
      <p className="text-xs text-slate-600">
        Use an unfiltered itemized report containing the original purchase and refund.
        Matching records tax evidence; it does not issue a refund or file a return.
      </p>
      <button className="ops-button" disabled={busy}>
        {busy ? "Checking report…" : "Match tax report"}
      </button>
      {message && (
        <p role="alert" className="text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
