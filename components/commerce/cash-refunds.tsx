"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-fetch";
import { Button } from "@/components/ui/button";
export function CashRefundActions({
  orderId,
  requestId,
  amount,
  canSubmit,
  canReconcile,
  enabled,
}: {
  orderId: string;
  requestId: string;
  amount: string;
  canSubmit: boolean;
  canReconcile: boolean;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState("");
  async function run(action: "submitCashRefund" | "reconcileCashRefund") {
    if (busy) return;
    setBusy(true);
    setError("");
    if (action === "submitCashRefund") setAttempted(true);
    try {
      await adminFetch(`/api/admin/orders/${orderId}/operations`, {
        method: "POST",
        body: JSON.stringify({
          action,
          confirmed: true,
          data: { orderId, requestId },
        }),
      });
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Refund outcome could not be confirmed. Reconcile this request before trying another refund.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {canSubmit &&
        !attempted &&
        (enabled ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run("submitCashRefund");
            }}
          >
            <label className="flex items-start gap-2">
              <input type="checkbox" required disabled={busy} className="mt-1" />
              Send {amount} to the original payment method. The result must be reconciled
              before credit and tax adjustments are final.
            </label>
            <Button type="submit" disabled={busy}>
              Submit payment refund
            </Button>
          </form>
        ) : (
          <p>
            Cash refund submission is not activated. This draft can be reviewed or
            canceled.
          </p>
        ))}
      {(canReconcile || attempted) && (
        <div className="space-y-2">
          <p>
            Check the existing provider refund and apply its verified accounting outcome.
            Reconciliation does not submit another refund.
          </p>
          <Button disabled={busy} onClick={() => void run("reconcileCashRefund")}>
            {busy ? "Checking refund…" : "Reconcile refund status"}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
