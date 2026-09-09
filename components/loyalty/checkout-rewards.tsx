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
  const [promotionCode, setPromotionCode] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section
      className="space-y-3 border-t border-teal-100 pt-4"
      aria-label="Checkout rewards"
    >
      <h3 className="font-semibold">Loyalty rewards</h3>
      <label className="block text-sm">
        Promo code (optional)
        <input
          aria-label="Promo code"
          value={promotionCode}
          maxLength={32}
          onChange={(e) => {
            setPromotionCode(e.target.value);
            setNotice(null);
          }}
          className="mt-1 block w-full rounded-xl border border-teal-200 p-3"
        />
      </label>
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
              body: JSON.stringify({
                lines: JSON.parse(fingerprint),
                ...(promotionCode.trim() ? { promotionCode: promotionCode.trim() } : {}),
              }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            setNotice({
              fingerprint,
              text: `Promotion discount: ${formatCents(result.discountCents ?? 0)}. ${result.rewardsAllowed === false ? "This promotion cannot be combined with rewards. " : ""}Rewards preview: ${formatCents(result.appliedCents)} would apply to merchandise; ${formatCents(result.remainingCents)} would remain. No rewards have been used. Final tax, payment and delivery booking are not connected.`,
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
