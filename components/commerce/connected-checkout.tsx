"use client";
import { useState } from "react";
import { useCart } from "@/components/storefront/cart-provider";
import { adminFetch } from "@/lib/admin-fetch";
import { formatCents } from "@/lib/domain/money";
import type { publicCheckout } from "@/lib/commerce/quote";
import { Button } from "@/components/ui/button";
import Link from "next/link";
type Quote = ReturnType<typeof publicCheckout>;
export function ConnectedCheckout({
  addresses,
  subscription,
  initialQuote,
}: {
  addresses: { id: string; label: string }[];
  initialQuote?: Quote;
  subscription?: {
    id: string;
    lines: {
      variantId: string;
      quantity: number;
      productName: string;
      unitPriceCents: number;
    }[];
  };
}) {
  const cart = useCart();
  const ready = Boolean(initialQuote) || Boolean(subscription) || cart.ready;
  const lines =
    initialQuote?.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      productName: line.name,
      unitPriceCents: line.unitPriceCents,
    })) ??
    subscription?.lines ??
    cart.lines;
  const [addressId, setAddress] = useState(addresses[0]?.id ?? "");
  const [promotionCode, setPromo] = useState("");
  const [useRewards, setRewards] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(initialQuote ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  if (!ready) return <p>Loading your cart…</p>;
  if (!lines.length)
    return (
      <p>
        Your cart is empty.{" "}
        <Link href="/shop" className="underline">
          Shop products
        </Link>
      </p>
    );
  if (!addresses.length)
    return (
      <p>
        Add a delivery address and request approval in{" "}
        <Link href="/account/addresses" className="underline">
          Delivery addresses
        </Link>{" "}
        before purchasing.
      </p>
    );
  async function review() {
    setBusy(true);
    setError("");
    const requestKey = pendingKey ?? crypto.randomUUID();
    setPendingKey(requestKey);
    try {
      setQuote(
        await adminFetch<Quote>("/api/checkout/quote", {
          method: "POST",
          body: JSON.stringify({
            requestKey,
            ...(subscription ? { subscriptionCycleId: subscription.id } : {}),
            addressId,
            lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
            ...(promotionCode ? { promotionCode } : {}),
            useRewards,
          }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quote unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    if (!quote) return;
    setBusy(true);
    setError("");
    try {
      const result = await adminFetch<Quote & { url: string | null }>(
        `/api/checkout/${quote.id}`,
        {
          method: "POST",
          body: JSON.stringify({ action: "pay", acceptedWindow: accepted }),
        },
      );
      window.location.assign(result.url ?? `/checkout/receipt/${quote.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment unavailable.");
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-4 rounded-3xl border border-teal-100 bg-white p-6">
        <h2 className="text-xl font-semibold">Your delivery</h2>
        {!quote ? (
          <fieldset disabled={busy} className="space-y-4">
            <label className="block">
              Approved delivery address
              <select
                className="mt-2 w-full rounded-xl border p-3"
                value={addressId}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setPendingKey(null);
                }}
              >
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Promotion code
              <input
                className="mt-2 w-full rounded-xl border p-3"
                value={promotionCode}
                maxLength={32}
                onChange={(e) => {
                  setPromo(e.target.value.toUpperCase());
                  setPendingKey(null);
                }}
              />
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={useRewards}
                onChange={(e) => {
                  setRewards(e.target.checked);
                  setPendingKey(null);
                }}
              />
              Apply available rewards
            </label>
            <Button onClick={review} disabled={busy}>
              Review order and delivery window
            </Button>
          </fieldset>
        ) : (
          <>
            <p>{quote.address}</p>
            <p>
              Delivery window:{" "}
              <strong>
                {quote.launchDate}–{quote.firstDeliveryBy}
              </strong>
              . Your exact delivery date will be confirmed after route review.
            </p>
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={accepted}
                disabled={busy}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              I accept this delivery window and payment at purchase.
            </label>
            <Button onClick={pay} disabled={busy || !accepted}>
              {busy ? "Opening payment…" : "Continue to secure payment"}
            </Button>
            <p className="text-sm">
              Stock, rewards and vehicle space are reserved before payment. Confirmation
              appears after payment verification.
            </p>
            <Link className="block underline" href={`/checkout/receipt/${quote.id}`}>
              Manage or cancel this checkout
            </Link>
          </>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-900">
            {error}
          </p>
        )}
      </section>
      <section className="space-y-3 rounded-3xl border border-teal-100 bg-white p-6">
        <h2 className="text-xl font-semibold">Order summary</h2>
        {(
          quote?.lines ??
          lines.map((l) => ({
            variantId: l.variantId,
            name: l.productName,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
          }))
        ).map((l) => (
          <p key={l.variantId}>
            {l.name} × {l.quantity}{" "}
            <span className="float-right">
              {subscription && !quote
                ? "Price at review"
                : formatCents(l.unitPriceCents * l.quantity)}
            </span>
          </p>
        ))}
        {quote ? (
          <dl className="space-y-2">
            {[
              ["Subtotal", quote.subtotalCents],
              ["Promotion", -quote.promotionCents],
              ["Rewards", -quote.rewardsCents],
              ["Sales tax", quote.taxCents],
              ["Delivery", 0],
              ["Pay now", quote.totalCents],
            ].map(([label, amount]) => (
              <div className="flex justify-between" key={String(label)}>
                <dt>{label}</dt>
                <dd>{formatCents(Number(amount))}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>
            Current prices, discounts and destination tax are confirmed when you review
            your order.
          </p>
        )}
      </section>
    </div>
  );
}
