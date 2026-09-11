"use client";
import { useState } from "react";
import type { deliveryTextStatus } from "@/lib/services/sms-delivery";
export function DeliveryTexts() {
  const [data, setData] = useState<Awaited<ReturnType<typeof deliveryTextStatus>> | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/delivery-texts");
      const v = await r.json();
      if (!r.ok) throw new Error(v.error ?? "Text status could not be loaded.");
      setData(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Text status could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4">
      <p>
        Review the latest 50 delivery updates. Unconfirmed submissions are held for
        receipt tracking; they are not sent again. Customers can always check their
        account.
      </p>
      <button className="ops-button" disabled={busy} onClick={load}>
        Refresh delivery texts
      </button>
      {data && (
        <>
          <p>
            New sends: {data.enabled ? "enabled for the configured sender" : "disabled"}
          </p>
          {data.rows.length === 0 ? (
            <p>No delivery texts have been queued.</p>
          ) : (
            data.rows.map((row) => (
              <article key={row.id} className="space-y-2 rounded-xl border bg-white p-4">
                <h2 className="font-semibold">{row.order}</h2>
                <p>
                  {row.kind === "DELIVERED" ? "Delivery complete" : "Out for delivery"} ·{" "}
                  {row.status.toLowerCase()}
                </p>
                <p>Submission attempts: {row.attempts}</p>
                {row.issue && (
                  <p className="text-amber-900">
                    Needs review: {row.issue.replaceAll("_", " ").toLowerCase()}.
                  </p>
                )}
                <p className="text-sm">
                  Queued {new Date(row.createdAt).toLocaleString()}
                </p>
              </article>
            ))
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
