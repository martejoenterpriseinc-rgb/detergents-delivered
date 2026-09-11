"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch, AdminRequestError } from "@/lib/admin-fetch";
import { Button } from "@/components/ui/button";

export function PrepareRewardRefund({
  orderId,
  paymentId,
  items,
}: {
  orderId: string;
  paymentId: string;
  items: { id: string; name: string; remaining: number }[];
}) {
  const router = useRouter();
  const pending = useRef<object | null>(null);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState("");
  if (!open)
    return <Button onClick={() => setOpen(true)}>Prepare reward credit return</Button>;
  return (
    <form
      className="space-y-4 rounded-xl border bg-white p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setError("");
        if (!pending.current) {
          const form = new FormData(event.currentTarget);
          const lines = items
            .map((i) => ({ orderItemId: i.id, quantity: Number(form.get(i.id)) }))
            .filter((i) => i.quantity > 0);
          if (!lines.length) {
            setError("Choose at least one unit.");
            return;
          }
          pending.current = {
            orderId,
            paymentId,
            requestKey: crypto.randomUUID(),
            reason: String(form.get("reason")).trim(),
            lines,
          };
        }
        setBusy(true);
        try {
          await adminFetch(`/api/admin/orders/${orderId}/operations`, {
            method: "POST",
            body: JSON.stringify({
              action: "prepareRewardRefund",
              data: pending.current,
            }),
          });
          pending.current = null;
          setUncertain(false);
          setOpen(false);
          router.refresh();
        } catch (e) {
          const rejected =
            e instanceof AdminRequestError && e.status >= 400 && e.status < 500;
          if (rejected) pending.current = null;
          setUncertain(!rejected);
          setError(e instanceof Error ? e.message : "Draft could not be confirmed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="text-lg font-semibold">Prepare reward credit return</h3>
      <p className="text-sm">
        Review the original reward credit before confirming. No cash or inventory moves.
      </p>
      <fieldset disabled={busy || uncertain} className="space-y-3">
        {items.map((i) => (
          <label key={i.id} className="grid gap-1">
            Credit return quantity for {i.name}
            <input
              name={i.id}
              type="number"
              min={0}
              max={Math.min(100, i.remaining)}
              step={1}
              defaultValue={0}
              required
              className="w-28 rounded-lg border p-2"
            />
          </label>
        ))}
        <label className="grid gap-1">
          Credit return reason
          <textarea
            name="reason"
            minLength={10}
            maxLength={500}
            required
            className="rounded-lg border p-2"
          />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      {uncertain && (
        <p>
          Draft result is unconfirmed. Retry the same draft or reload to inspect saved
          requests.
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy
          ? "Saving…"
          : uncertain
            ? "Retry same credit draft"
            : "Review reward credit"}
      </Button>
    </form>
  );
}
export function RestoreRewardRefund({
  orderId,
  requestId,
  amount,
}: {
  orderId: string;
  requestId: string;
  amount: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          await adminFetch(`/api/admin/orders/${orderId}/operations`, {
            method: "POST",
            body: JSON.stringify({
              action: "restoreRewardRefund",
              confirmed: true,
              data: { orderId, requestId },
            }),
          });
          router.refresh();
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "Credit restoration could not be confirmed. Retry this request.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="flex items-start gap-2">
        <input type="checkbox" required disabled={busy} className="mt-1" />
        Restore {amount} of original reward credit. No cash refund or stock return.
      </label>
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Restoring…" : "Confirm reward restoration"}
      </Button>
    </form>
  );
}
