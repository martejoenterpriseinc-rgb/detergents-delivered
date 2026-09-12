"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { readManualRefunds } from "@/lib/services/manual-refunds";
type Data = Awaited<ReturnType<typeof readManualRefunds>>;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
export function ManualRefunds({ data }: { data: Data }) {
  const router = useRouter(),
    pending = useRef<{ method: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState("");
  async function send(method: string, body: unknown) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    pending.current ??= { method, body: JSON.stringify(body) };
    try {
      const res = await fetch("/api/admin/manual-refunds", {
        method: pending.current.method,
        headers: { "Content-Type": "application/json" },
        body: pending.current.body,
      });
      if (res.status >= 400 && res.status < 500) pending.current = null;
      const result = await res.json();
      if (!res.ok) throw Error(result.error ?? "Refund needs review.");
      pending.current = null;
      setMessage(
        method === "PATCH"
          ? "Returned money recorded. Do not return it again. Tax verification is still required."
          : method === "DELETE"
            ? "Unpaid refund draft canceled."
            : "Refund prepared. Review the exact amount before returning money.",
      );
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
    <div className="space-y-5">
      {!data.enabled && (
        <p role="status">
          New manual refunds are not activated. Existing return receipts can still be
          recorded.
        </p>
      )}
      {data.canWrite && data.enabled && (
        <form
          className="space-y-3 rounded-xl border bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void send("POST", {
              orderId: data.orderId,
              paymentId: data.paymentId,
              requestKey: crypto.randomUUID(),
              reason: f.get("reason"),
              lines: data.lines
                .map((l) => ({ orderItemId: l.id, quantity: Number(f.get(l.id)) }))
                .filter((l) => l.quantity > 0),
            });
          }}
        >
          <h2 className="text-xl font-semibold">Prepare item refund</h2>
          <fieldset disabled={busy || uncertain} className="space-y-3">
            {data.lines.map((l) => (
              <label key={l.id} className="block">
                {l.name} · {l.remaining} available
                <input
                  aria-label={`Refund quantity for ${l.name}`}
                  name={l.id}
                  type="number"
                  min="0"
                  max={l.remaining}
                  step="1"
                  defaultValue="0"
                  className="mt-1 block w-full rounded-lg border p-3"
                />
              </label>
            ))}
            <label className="block">
              Refund reason
              <textarea
                name="reason"
                minLength={10}
                maxLength={500}
                required
                className="mt-1 block w-full rounded-lg border p-3"
              />
            </label>
            <button className="ops-button">Prepare refund</button>
          </fieldset>
        </form>
      )}
      {data.requests.map((r) => (
        <article key={r.id} className="space-y-3 rounded-xl border bg-white p-5">
          <h2 className="text-xl font-semibold">
            {money(r.amountCents)} ·{" "}
            {r.status === "SUCCEEDED" ? "Money returned" : r.status}
          </h2>
          <p>{r.reason}</p>
          <p>
            Included tax: {money(r.taxCents)} · Reward credit: {money(r.rewardCents)}
          </p>
          {r.status === "SUCCEEDED" && (
            <p>
              Return receipt recorded. Tax verification and accounting posting are
              separate steps.
            </p>
          )}
          {r.status === "PREPARED" && data.canWrite && (
            <>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void send("PATCH", {
                    orderId: data.orderId,
                    requestId: r.id,
                    method: data.method,
                    amountCents: r.amountCents,
                    reference: f.get("reference"),
                    reason: f.get("reason"),
                    returnedAt: new Date(String(f.get("returnedAt"))).toISOString(),
                    confirmed: f.get("confirmed") === "on",
                  });
                }}
              >
                <fieldset disabled={busy || uncertain} className="space-y-3">
                  <label className="block">
                    {data.method} return receipt reference
                    <input
                      name="reference"
                      minLength={5}
                      maxLength={160}
                      required
                      className="mt-1 block w-full rounded-lg border p-3"
                    />
                  </label>
                  <label className="block">
                    Money returned at (your local time)
                    <input
                      name="returnedAt"
                      type="datetime-local"
                      required
                      className="mt-1 block w-full rounded-lg border p-3"
                    />
                  </label>
                  <label className="block">
                    Return evidence notes
                    <textarea
                      name="reason"
                      minLength={10}
                      maxLength={500}
                      required
                      className="mt-1 block w-full rounded-lg border p-3"
                    />
                  </label>
                  <label className="flex gap-2">
                    <input name="confirmed" type="checkbox" required />I verified that{" "}
                    {money(r.amountCents)} was returned through {data.method}. This
                    records a completed return.
                  </label>
                  <button className="ops-button">Record returned money</button>
                </fieldset>
              </form>
              <button
                className="ops-button-secondary"
                disabled={busy || uncertain}
                onClick={() => {
                  if (
                    window.confirm(
                      "Cancel this draft only if no money has been returned?",
                    )
                  )
                    void send("DELETE", {
                      orderId: data.orderId,
                      requestId: r.id,
                      reason:
                        "Staff confirmed no money was returned; cancel unused refund draft.",
                    });
                }}
              >
                Cancel unused draft
              </button>
            </>
          )}
        </article>
      ))}
      {uncertain && (
        <button
          className="ops-button"
          disabled={busy}
          onClick={() => void send(pending.current!.method, {})}
        >
          Retry same request
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
