"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
export function ManualRefundTax({
  orderId,
  requestId,
  status,
  canWrite,
}: {
  orderId: string;
  requestId: string;
  status: string;
  canWrite: boolean;
}) {
  const router = useRouter(),
    pending = useRef<string | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [retry, setRetry] = useState(false);
  if (status === "VERIFIED")
    return (
      <p>
        Tax reversal verified. This refund is ready for the accounting receipt workflow.
      </p>
    );
  async function submit(form: FormData) {
    setBusy(true);
    setMessage("");
    pending.current ??= JSON.stringify({
      orderId,
      requestId,
      confirmed: true,
      ...(retry ? { retrySameRequest: true } : {}),
      ...(form.get("taxTransactionId")
        ? { taxTransactionId: form.get("taxTransactionId") }
        : {}),
    });
    try {
      const response = await fetch("/api/admin/manual-refunds/tax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: pending.current,
      });
      const data = await response.json();
      if (response.status >= 400 && response.status < 500) pending.current = null;
      if (!response.ok) throw Error(data.error ?? "Tax verification needs review.");
      pending.current = null;
      setMessage("Tax reversal verified.");
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Tax outcome is uncertain. Recover the existing reversal; do not submit another.",
      );
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <div className="space-y-3">
      <p>
        Tax reversal:{" "}
        {status === "RECOVERY" ? "existing transaction lookup required" : "pending"}.
      </p>
      {canWrite && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          {status === "RECOVERY" && (
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={retry}
                disabled={busy}
                onChange={(e) => setRetry(e.target.checked)}
              />
              Retry the original tax request within its 23-hour safe window.
            </label>
          )}
          {status === "RECOVERY" && !retry && (
            <label className="block">
              Existing Stripe Tax reversal ID
              <input
                name="taxTransactionId"
                required
                pattern="tax_[A-Za-z0-9]+"
                disabled={busy}
                className="mt-1 block w-full rounded-lg border p-3"
              />
            </label>
          )}
          <button disabled={busy} className="ops-button">
            {busy
              ? "Checking…"
              : retry
                ? "Retry original tax request"
                : status === "RECOVERY"
                  ? "Verify existing tax reversal"
                  : "Submit tax reversal"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
