"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch, AdminRequestError } from "@/lib/admin-fetch";
import { Button } from "@/components/ui/button";

type Item = {
  id: string;
  nameSnapshot: string;
  quantity: number;
  returnedQuantity: number;
};

export function ReceiveOrderReturn({
  orderId,
  items,
}: {
  orderId: string;
  items: Item[];
}) {
  const router = useRouter();
  const pending = useRef<{
    requestKey: string;
    orderId: string;
    reason: string;
    lines: { orderItemId: string; quantity: number; condition: string }[];
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const available = items.filter((item) => item.quantity > item.returnedQuantity);
  if (saved)
    return (
      <p role="status" className="rounded-xl bg-teal-50 p-4">
        Return received and inventory updated.
      </p>
    );
  if (!available.length) return <p>All purchased units have been received back.</p>;
  if (!open) return <Button onClick={() => setOpen(true)}>Receive returned goods</Button>;

  async function submit(form: HTMLFormElement) {
    if (busy) return;
    setError("");
    if (!pending.current) {
      const data = new FormData(form);
      const lines = available
        .map((item) => ({
          orderItemId: item.id,
          quantity: Number(data.get(`quantity-${item.id}`)),
          condition: String(data.get(`condition-${item.id}`)),
        }))
        .filter((line) => line.quantity > 0);
      if (!lines.length) {
        setError("Choose at least one returned unit.");
        return;
      }
      pending.current = {
        requestKey: crypto.randomUUID(),
        orderId,
        reason: String(data.get("reason")).trim(),
        lines,
      };
    }
    setBusy(true);
    try {
      await adminFetch(`/api/admin/orders/${orderId}/operations`, {
        method: "POST",
        body: JSON.stringify({
          action: "receiveReturn",
          confirmed: true,
          data: pending.current,
        }),
      });
      setSaved(true);
      setUncertain(false);
      pending.current = null;
      router.refresh();
    } catch (e) {
      // Keep the exact payload/key on any ambiguous response. Staff can safely
      // retry the same receipt without doubling the inventory movement.
      const rejected =
        e instanceof AdminRequestError && e.status >= 400 && e.status < 500;
      setUncertain(!rejected);
      if (rejected) pending.current = null;
      setError(e instanceof Error ? e.message : "The return could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
      className="space-y-4 rounded-xl border bg-white p-4"
    >
      <h3 className="text-lg font-semibold">Receive returned goods</h3>
      <p className="text-sm text-teal-800">
        Record goods you have received and inspected. Payment refunds are handled
        separately.
      </p>
      <fieldset disabled={busy || uncertain} className="space-y-4">
        {available.map((item) => (
          <div
            key={item.id}
            className="grid min-w-0 gap-3 border-b pb-4 sm:grid-cols-[minmax(0,1fr)_7rem_10rem]"
          >
            <div className="min-w-0 break-words">
              <strong>{item.nameSnapshot}</strong>
              <p className="text-sm">
                {item.quantity - item.returnedQuantity} remaining to return
              </p>
            </div>
            <label className="text-sm">
              Quantity for {item.nameSnapshot}
              <input
                name={`quantity-${item.id}`}
                type="number"
                min={0}
                max={Math.min(100, item.quantity - item.returnedQuantity)}
                step={1}
                defaultValue={0}
                className="mt-1 block w-full rounded-lg border p-2"
                required
              />
            </label>
            <div className="text-sm">
              <label htmlFor={`return-condition-${item.id}`}>
                Condition for {item.nameSnapshot}
              </label>
              <select
                id={`return-condition-${item.id}`}
                name={`condition-${item.id}`}
                className="mt-1 block w-full rounded-lg border p-2"
              >
                <option value="SELLABLE">Sellable</option>
                <option value="DAMAGED">Damaged</option>
              </select>
            </div>
          </div>
        ))}
        <label className="block">
          Return reason
          <textarea
            name="reason"
            minLength={10}
            maxLength={500}
            required
            className="mt-1 block w-full rounded-lg border p-2"
          />
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" required className="mt-1" />I received these goods and
          checked their condition.
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="break-words text-red-800">
          {error}
        </p>
      )}
      {uncertain && (
        <p className="text-sm">
          The save result is unconfirmed. Retry the same receipt or reload to check return
          history before starting another.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : uncertain ? "Retry same receipt" : "Save received return"}
        </Button>
        {!uncertain && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function CancelRefundDraft({
  orderId,
  requestId,
}: {
  orderId: string;
  requestId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (saved) return <p role="status">Refund draft canceled. No money was moved.</p>;
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Cancel refund draft
      </Button>
    );
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const reason = String(new FormData(event.currentTarget).get("reason"));
        setBusy(true);
        setError("");
        try {
          await adminFetch(`/api/admin/orders/${orderId}/operations`, {
            method: "POST",
            body: JSON.stringify({
              action: "cancelRefundDraft",
              data: { orderId, requestId, reason },
            }),
          });
          setSaved(true);
          router.refresh();
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "Cancellation could not be confirmed. Retry to check.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block">
        Cancellation reason
        <textarea
          name="reason"
          minLength={10}
          maxLength={500}
          required
          disabled={busy}
          className="mt-1 block w-full rounded-lg border p-2"
        />
      </label>
      <p className="text-sm">
        Canceling an unused draft releases its reserved amount. It does not move money.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy}>Confirm draft cancellation</Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Keep draft
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
