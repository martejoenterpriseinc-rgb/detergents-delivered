"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProductMedia } from "@/components/storefront/product-media";
import { useCart } from "@/components/storefront/cart-provider";
import { demoOrderTotals, lineTotalCents } from "@/lib/cart";
import { formatCents } from "@/lib/domain/money";

export function CartView() {
  const { ready, lines, setQuantity, removeLine, subtotalCents } = useCart();
  const totals = demoOrderTotals(subtotalCents);

  if (!ready) {
    return <p className="text-sm text-teal-800">Loading your cart…</p>;
  }

  if (lines.length === 0) {
    return (
      <Card className="space-y-4">
        <p className="text-lg font-semibold text-teal-950">Your cart is empty</p>
        <p className="text-sm text-teal-800">
          Add detergent, dish, or paper staples and we will show a demo checkout — no card
          required.
        </p>
        <Link href="/shop">
          <Button>Browse the shop</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
      <div className="space-y-4">
        {lines.map((line) => (
          <Card key={line.variantId} className="grid gap-4 p-4 sm:grid-cols-[7rem_1fr]">
            <ProductMedia
              name={line.productName}
              brand={line.brand}
              imageId={line.imageId}
              className="h-28"
            />
            <div className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs tracking-wide text-teal-700 uppercase">
                    {line.brand}
                  </p>
                  <p className="font-semibold text-teal-950">{line.productName}</p>
                  <p className="text-sm text-teal-800">{line.variantName}</p>
                </div>
                <p className="font-semibold text-teal-950">
                  {formatCents(lineTotalCents(line))}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className="text-xs text-teal-800"
                  htmlFor={`qty-${line.variantId}`}
                >
                  Qty
                </label>
                <input
                  id={`qty-${line.variantId}`}
                  type="number"
                  min={1}
                  max={24}
                  value={line.quantity}
                  onChange={(event) =>
                    setQuantity(line.variantId, Number(event.target.value) || 1)
                  }
                  className="h-10 w-20 rounded-2xl border border-teal-200 px-3 text-sm"
                />
                <button
                  type="button"
                  className="text-sm text-teal-800 underline"
                  onClick={() => removeLine(line.variantId)}
                >
                  Remove
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="h-fit space-y-3">
        <p className="text-lg font-semibold text-teal-950">Order summary</p>
        <div className="flex justify-between text-sm text-teal-800">
          <span>Subtotal</span>
          <span>{formatCents(totals.subtotalCents)}</span>
        </div>
        <div className="flex justify-between text-sm text-teal-800">
          <span>Delivery {totals.deliveryFeeCents === 0 ? "(free over $35)" : ""}</span>
          <span>
            {totals.deliveryFeeCents === 0
              ? "Free"
              : formatCents(totals.deliveryFeeCents)}
          </span>
        </div>
        <div className="flex justify-between text-sm text-teal-800">
          <span>Est. tax (demo)</span>
          <span>{formatCents(totals.taxCents)}</span>
        </div>
        <div className="flex justify-between border-t border-teal-100 pt-3 font-semibold text-teal-950">
          <span>Total</span>
          <span>{formatCents(totals.totalCents)}</span>
        </div>
        <Link href="/checkout">
          <Button className="w-full">Continue to demo checkout</Button>
        </Link>
        <p className="text-xs text-teal-700">
          Prices are stored in your browser for this mockup.
        </p>
      </Card>
    </div>
  );
}
