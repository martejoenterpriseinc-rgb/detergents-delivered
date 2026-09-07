"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DemoBanner } from "@/components/storefront/demo-banner";
import { DEMO_ORDERS_STORAGE_KEY, type DemoOrder } from "@/lib/cart";
import { formatCents } from "@/lib/domain/money";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getConfirmationRaw() {
  return `${sessionStorage.getItem("dd-last-demo-order") ?? ""}\n---\n${localStorage.getItem(DEMO_ORDERS_STORAGE_KEY) ?? ""}`;
}

function parseConfirmation(raw: string | null, orderId?: string): DemoOrder | null {
  if (!raw) return null;
  const [last, stored] = raw.split("\n---\n");
  if (last) {
    try {
      const parsed = JSON.parse(last) as DemoOrder;
      if (!orderId || parsed.id === orderId) return parsed;
    } catch {
      /* ignore */
    }
  }
  if (!stored) return null;
  try {
    const list = JSON.parse(stored) as DemoOrder[];
    return (orderId ? list.find((item) => item.id === orderId) : list[0]) ?? null;
  } catch {
    return null;
  }
}

export function ConfirmationView({ orderId }: { orderId?: string }) {
  const raw = useSyncExternalStore(subscribe, getConfirmationRaw, () => null);
  const order = useMemo(() => parseConfirmation(raw, orderId), [orderId, raw]);

  if (!order) {
    return (
      <Card className="space-y-3">
        <p className="font-semibold text-teal-950">No demo confirmation found</p>
        <p className="text-sm text-teal-800">
          Place a demo order from checkout, or browse the shop to start again.
        </p>
        <Link href="/shop">
          <Button>Back to shop</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <DemoBanner>
        Demo confirmation only — no payment was collected and no driver was assigned.
      </DemoBanner>
      <Card className="space-y-3">
        <p className="text-sm tracking-wide text-teal-700 uppercase">
          Order confirmed (demo)
        </p>
        <h1 className="text-3xl font-semibold text-teal-950">
          Thanks, {order.name.split(" ")[0]}.
        </h1>
        <p className="text-teal-800">
          We saved confirmation <span className="font-semibold">{order.id}</span> in this
          browser. Delivery area: {order.zoneName}. Weekly delivery on scheduled route
          days
          {order.nextWindowLabel ? ` — next window ${order.nextWindowLabel}` : ""}. Not
          same-day.
        </p>
        <p className="text-sm text-teal-800">
          {order.address.line1}, {order.address.city}, {order.address.region}{" "}
          {order.address.postalCode}
        </p>
        <ul className="space-y-1 text-sm text-teal-800">
          {order.lines.map((line) => (
            <li key={line.variantId}>
              {line.productName} ({line.variantName}) × {line.quantity}
            </li>
          ))}
        </ul>
        <p className="font-semibold text-teal-950">
          Total {formatCents(order.totals.totalCents)}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/shop">
            <Button>Keep shopping</Button>
          </Link>
          <Link href="/account">
            <Button variant="outline">View account</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
