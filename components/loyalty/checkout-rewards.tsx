"use client";
import { useState } from "react";
import { useCart } from "@/components/storefront/cart-provider";
import { formatCents } from "@/lib/domain/money";
export function CheckoutRewards() {
  const { lines } = useCart();
  const fingerprint = JSON.stringify(
    lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
  );
  const [notice, setNotice] = useState<{ fingerprint: string; text: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section
      className="space-y-3 border-t border-teal-100 pt-4"
      aria-label="Checkout rewards"
    >
      <h3 className="font-semibold">Loyalty rewards</h3>
      <button
        type="button"
        className="min-h-11 rounded-full bg-teal-700 px-5 py-2 font-semibold text-white disabled:opacity-50"
        disabled={busy || !lines.length}
        onClick={async () => {
          setBusy(true);
          setError("");
          setNotice(null);
          try {
            const response = await fetch("/api/account/rewards/quote", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lines: JSON.parse(fingerprint) }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            setNotice({
              fingerprint,
              text: `Rewards preview: ${formatCents(result.appliedCents)} would apply to merchandise; ${formatCents(result.remainingCents)} would remain. No rewards have been used. Final tax, payment and delivery booking are not connected.`,
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Rewards could not be checked.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking rewards…" : "Apply rewards"}
      </button>
      <p className="text-xs text-teal-700">
        Preview only. The final checkout will use only the credits needed and retain the
        rest. Your balance changes only after a confirmed order.
      </p>
      {notice?.fingerprint === fingerprint && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl bg-teal-100 p-4 text-sm"
        >
          {notice.text}
          <button
            type="button"
            className="mt-2 block font-semibold underline"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-900">
          {error}
        </p>
      )}
    </section>
  );
}
