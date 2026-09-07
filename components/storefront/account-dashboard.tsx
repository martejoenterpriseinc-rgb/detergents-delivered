"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DemoBanner } from "@/components/storefront/demo-banner";
import {
  DEMO_ORDERS_STORAGE_KEY,
  SAMPLE_ACCOUNT_ORDERS,
  type DemoOrder,
} from "@/lib/cart";
import { formatCents } from "@/lib/domain/money";

const STATUS_LABEL: Record<DemoOrder["status"], string> = {
  confirmed: "Confirmed",
  packing: "Packing",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
};

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getDemoOrdersRaw() {
  return localStorage.getItem(DEMO_ORDERS_STORAGE_KEY);
}

function parseDemoOrders(raw: string | null): DemoOrder[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as DemoOrder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function AccountDashboard({ email, roles }: { email: string; roles: string[] }) {
  const raw = useSyncExternalStore(subscribe, getDemoOrdersRaw, () => null);
  const stored = useMemo(() => parseDemoOrders(raw), [raw]);
  const orders = stored.length > 0 ? stored : SAMPLE_ACCOUNT_ORDERS;
  const usingSample = stored.length === 0;

  return (
    <div className="space-y-6">
      <DemoBanner>
        Account history is a storefront mock. Live Stripe orders and subscriptions are not
        connected yet.
      </DemoBanner>
      <Card className="space-y-2">
        <p className="text-sm font-medium text-teal-900">{email}</p>
        <p className="text-sm text-teal-800">Roles: {roles.join(", ") || "CUSTOMER"}</p>
      </Card>
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold text-teal-950">Orders</h2>
          {usingSample ? (
            <p className="text-xs text-teal-700">
              Sample orders — place a demo checkout to replace these
            </p>
          ) : (
            <p className="text-xs text-teal-700">Saved in this browser</p>
          )}
        </div>
        <div className="grid gap-3">
          {orders.map((order) => (
            <Card key={order.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-teal-950">{order.id}</p>
                  <p className="text-xs text-teal-700">
                    {new Date(order.placedAt).toLocaleDateString()} ·{" "}
                    {STATUS_LABEL[order.status]}
                  </p>
                </div>
                <p className="font-semibold text-teal-950">
                  {formatCents(order.totals.totalCents)}
                </p>
              </div>
              <p className="text-sm text-teal-800">
                {order.lines
                  .map((line) => `${line.productName} × ${line.quantity}`)
                  .join(" · ")}
              </p>
            </Card>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold text-teal-950">Subscriptions</h2>
          <Link
            href="/account/subscriptions"
            className="text-sm font-semibold text-teal-800"
          >
            Manage
          </Link>
        </div>
        <Card className="space-y-3">
          <p className="font-semibold text-teal-950">Coming with Phase 5</p>
          <p className="text-sm text-teal-800">
            You will pause, skip, or swap a detergent here. For this mockup, imagine a
            4-week Fresh Breeze 64 oz subscription at the subscribe price — no billing is
            attached.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled>
              Pause (soon)
            </Button>
            <Button type="button" variant="outline" disabled>
              Skip next (soon)
            </Button>
            <Link href="/shop">
              <Button variant="secondary">Shop one-time instead</Button>
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
