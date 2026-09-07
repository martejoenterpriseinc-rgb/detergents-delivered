"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DemoBanner } from "@/components/storefront/demo-banner";
import { DeliveryChecker } from "@/components/storefront/delivery-checker";
import { useCart } from "@/components/storefront/cart-provider";
import {
  createDemoOrderId,
  DEMO_ORDERS_STORAGE_KEY,
  demoOrderTotals,
  type DemoOrder,
} from "@/lib/cart";
import { checkDeliveryZip, zoneNameForZip } from "@/lib/delivery-area";
import { formatCents } from "@/lib/domain/money";

export function CheckoutForm() {
  const router = useRouter();
  const { ready, lines, subtotalCents, clear } = useCart();
  const totals = useMemo(() => demoOrderTotals(subtotalCents), [subtotalCents]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!ready) {
    return <p className="text-sm text-teal-800">Loading checkout…</p>;
  }

  if (lines.length === 0) {
    return (
      <Card className="space-y-3">
        <p className="font-semibold text-teal-950">Nothing to check out</p>
        <p className="text-sm text-teal-800">Add a few household staples first.</p>
        <Button type="button" onClick={() => router.push("/shop")}>
          Go to shop
        </Button>
      </Card>
    );
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        const name = String(data.get("name") ?? "").trim();
        const email = String(data.get("email") ?? "").trim();
        const phone = String(data.get("phone") ?? "").trim();
        const line1 = String(data.get("line1") ?? "").trim();
        const line2 = String(data.get("line2") ?? "").trim();
        const city = String(data.get("city") ?? "").trim();
        const region = String(data.get("region") ?? "").trim();
        const postalCode = String(data.get("postalCode") ?? "").trim();
        const area = checkDeliveryZip(postalCode);
        if (!name || !email || !line1 || !city || !region) {
          setError("Please fill in name, email, and a complete delivery address.");
          return;
        }
        if (!area.ok) {
          setError(area.message);
          return;
        }
        setSubmitting(true);
        const order: DemoOrder = {
          id: createDemoOrderId(),
          placedAt: new Date().toISOString(),
          status: "confirmed",
          email,
          name,
          phone,
          address: {
            line1,
            line2: line2 || undefined,
            city,
            region,
            postalCode: area.zip,
          },
          zoneName: zoneNameForZip(area.zip) ?? area.zoneName,
          lines,
          totals,
          note: "Demo confirmation only. No payment was collected.",
        };
        const existingRaw = localStorage.getItem(DEMO_ORDERS_STORAGE_KEY);
        const existing = existingRaw ? (JSON.parse(existingRaw) as DemoOrder[]) : [];
        localStorage.setItem(
          DEMO_ORDERS_STORAGE_KEY,
          JSON.stringify([order, ...existing]),
        );
        sessionStorage.setItem("dd-last-demo-order", JSON.stringify(order));
        clear();
        router.push(`/checkout/confirmation?order=${encodeURIComponent(order.id)}`);
      }}
    >
      <div className="space-y-4">
        <DemoBanner>
          <strong>Demo checkout — payments not live.</strong> Place order creates a local
          confirmation only. We will not charge a card or send this to QuickBooks.
        </DemoBanner>
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-teal-950">Delivery details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" autoComplete="tel" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="line1">Street address</Label>
              <Input id="line1" name="line1" autoComplete="address-line1" required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="line2">Apartment, suite (optional)</Label>
              <Input id="line2" name="line2" autoComplete="address-line2" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" autoComplete="address-level2" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="region">State</Label>
              <Input
                id="region"
                name="region"
                autoComplete="address-level1"
                defaultValue="IA"
                required
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="postalCode">ZIP</Label>
              <Input
                id="postalCode"
                name="postalCode"
                autoComplete="postal-code"
                defaultValue="50309"
                required
              />
            </div>
          </div>
          <DeliveryChecker defaultZip="50309" compact />
        </Card>
        {error ? (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full sm:w-auto" disabled={submitting}>
          {submitting ? "Placing demo order…" : "Place order (demo)"}
        </Button>
      </div>
      <Card className="h-fit space-y-3">
        <h2 className="text-lg font-semibold text-teal-950">Order summary</h2>
        <ul className="space-y-2 text-sm text-teal-800">
          {lines.map((line) => (
            <li key={line.variantId} className="flex justify-between gap-3">
              <span>
                {line.productName} × {line.quantity}
              </span>
              <span>{formatCents(line.unitPriceCents * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between text-sm text-teal-800">
          <span>Subtotal</span>
          <span>{formatCents(totals.subtotalCents)}</span>
        </div>
        <div className="flex justify-between text-sm text-teal-800">
          <span>Delivery</span>
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
      </Card>
    </form>
  );
}
