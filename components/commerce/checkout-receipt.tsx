"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { adminFetch } from "@/lib/admin-fetch";
import { formatCents } from "@/lib/domain/money";
import type { publicCheckout } from "@/lib/commerce/quote";
import { Button } from "@/components/ui/button";
type Receipt = ReturnType<typeof publicCheckout> & { remainingRewardsCents?: number };
export function CheckoutReceipt({ initial }: { initial: Receipt }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (["PAID", "EXPIRED", "REFUNDED"].includes(data.state)) return;
    let live = true;
    const timer = setInterval(() => {
      void adminFetch<Receipt>(`/api/checkout/${data.id}`)
        .then((d) => {
          if (live) setData(d);
        })
        .catch(() => {
          if (live)
            setError(
              "Status updates are temporarily unavailable. Your payment has not been repeated.",
            );
        });
    }, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [data.id, data.state]);
  async function action(name: string) {
    setBusy(true);
    setError("");
    try {
      await adminFetch(`/api/checkout/${data.id}`, {
        method: "POST",
        body: JSON.stringify({ action: name }),
      });
      setData(await adminFetch<Receipt>(`/api/checkout/${data.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const paid = data.state === "PAID";
  return (
    <section className="mx-auto max-w-2xl space-y-5 rounded-3xl border border-teal-100 bg-white p-6">
      <h1 className="text-2xl font-semibold">
        {paid
          ? "Order confirmed"
          : data.state === "REFUNDED"
            ? "Order refunded"
            : data.state === "EXPIRED"
              ? "Checkout cancelled or expired"
              : data.state === "REVIEW"
                ? "Payment needs staff review"
                : "Checking payment status"}
      </h1>
      {data.paymentMethod !== "STRIPE" && !paid && (
        <p>
          Your approved {data.paymentMethod === "CASH" ? "cash" : "Zelle"} checkout awaits
          staff confirmation of received money and tax. Contact staff to arrange payment;
          do not send a second payment while confirmation is pending.
        </p>
      )}
      <p
        className={`rounded-xl p-3 ${paid ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-950"}`}
        role="status"
      >
        {paid
          ? `Your order is saved. Payment total: ${formatCents(data.totalCents)}.`
          : data.state === "REFUNDED"
            ? "This order is marked refunded. Its original purchase receipt remains available."
            : "Only a verified payment confirms an order. Do not pay again while confirmation is pending."}
      </p>
      {["PAID", "REFUNDED"].includes(data.state) && data.orderId && (
        <Link
          className="inline-block font-semibold text-teal-800 underline"
          href={`/receipts/${data.id}`}
        >
          Print or save your original receipt
        </Link>
      )}
      {paid && data.rewardsCents > 0 && (
        <p role="status" className="rounded-xl bg-teal-50 p-3">
          {formatCents(data.rewardsCents)} rewards used on this order.{" "}
          {data.remainingRewardsCents !== undefined
            ? `${formatCents(data.remainingRewardsCents)} remains in your rewards balance.`
            : "Open Loyalty Club for your current balance."}
        </p>
      )}
      <p>Delivery address: {data.address}</p>
      <p>
        Delivery window: {data.launchDate}–{data.firstDeliveryBy}. The exact date will be
        confirmed after route review.
      </p>
      {data.lines.map((l) => (
        <p key={l.variantId}>
          {l.name} × {l.quantity}
        </p>
      ))}
      {!paid && !["EXPIRED", "REFUNDED"].includes(data.state) && (
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} onClick={() => action("refresh")}>
            Check payment
          </Button>
          <Button disabled={busy} onClick={() => action("cancel")}>
            Cancel checkout
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-rose-900">
          {error}
        </p>
      )}
      <div className="flex gap-4">
        <Link href="/account" className="underline">
          Your account
        </Link>
        <Link href="/account/loyalty" className="underline">
          Loyalty Club
        </Link>
        <Link href="/account/support" className="underline">
          Contact support
        </Link>
      </div>
    </section>
  );
}
