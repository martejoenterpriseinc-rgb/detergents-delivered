"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-fetch";
import { orderMoney } from "@/lib/domain/order-workspace";
import type { reviewPaymentRefunds } from "@/lib/services/refund-review";

export function RefundReview({
  orderId,
  paymentId,
}: {
  orderId: string;
  paymentId: string;
}) {
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof reviewPaymentRefunds>
  > | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-4 space-y-3">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setResult(null);
          try {
            setResult(
              await adminFetch(
                `/api/admin/orders/${encodeURIComponent(orderId)}/refund-review`,
                {
                  method: "POST",
                  body: JSON.stringify({ orderId, paymentId }),
                },
              ),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "Refund review unavailable.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking refunds…" : "Check refunds with Stripe"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div role="status" className="space-y-2 rounded-xl border p-3">
          <p>
            Stripe refund history · checked{" "}
            {new Date(result.checkedAt).toLocaleTimeString()}
          </p>
          <p>
            {result.providerRefundCount} refunds · Succeeded{" "}
            {orderMoney(result.succeededCents, result.currency)} · Pending{" "}
            {orderMoney(result.pendingCents, result.currency)}
          </p>
          <p>
            Failed or canceled:{" "}
            {orderMoney(result.failedOrCanceledCents, result.currency)}
          </p>
          {result.disputed && (
            <p className="font-semibold">
              Payment disputed. Review the dispute before any refund.
            </p>
          )}
          {!!result.unresolvedRequests && (
            <p className="font-semibold">
              {result.unresolvedRequests} submitted requests remain unconfirmed. Do not
              submit them again.
            </p>
          )}
          {!!result.changedRequests && (
            <p className="font-semibold">
              {result.changedRequests} requests differ from saved status and need
              reconciliation.
            </p>
          )}
          <p className="text-sm">
            Inspection only. Saved refund records and balances are unchanged.
          </p>
        </div>
      )}
    </div>
  );
}
