"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { deliveryStates, type DeliverySnapshot } from "@/lib/domain/loyalty";
export function DeliveryWidget({ initial }: { initial: DeliverySnapshot }) {
  const router = useRouter();
  const savedKey = JSON.stringify([
    initial.status,
    initial.orderNumber,
    initial.plannedArrival,
  ]);
  const [snapshot, setSnapshot] = useState(initial);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let stopped = false;
    let busy = false;
    let controller: AbortController | undefined;
    async function refresh() {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const response = await fetch("/api/account/delivery-status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Update unavailable");
        const data: DeliverySnapshot = await response.json();
        if (!(data.status in deliveryStates)) throw new Error("Unknown delivery state");
        if (!stopped) {
          setSnapshot(data);
          setUnavailable(false);
          const nextKey = JSON.stringify([
            data.status,
            data.orderNumber,
            data.plannedArrival,
          ]);
          if (nextKey !== savedKey) {
            // Retry until server props confirm the new state. An interrupted
            // refresh must not leave order cards stale after the widget updates.
            router.refresh();
          }
        }
      } catch {
        if (!stopped) setUnavailable(true);
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    }
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      controller?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, savedKey]);
  const state = deliveryStates[snapshot.status];
  return (
    <Link
      href="/account/deliveries"
      data-testid="delivery-widget"
      className="rounded-3xl focus-visible:outline-2 focus-visible:outline-teal-700"
    >
      <Card className="flex h-32 items-center gap-4 hover:bg-teal-50">
        <Truck className="h-6 w-6 shrink-0 text-teal-700" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="font-semibold">Delivery status</h2>
          <p
            aria-live="polite"
            className="mt-1 flex items-center gap-2 text-sm text-teal-800"
          >
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${unavailable ? "bg-slate-400" : state.color}`}
            />
            {unavailable ? "Updates unavailable" : state.label}
          </p>
          <p className="mt-1 text-xs text-teal-700">
            {unavailable ? `Last saved: ${state.label}` : "Auto-updates every 15 seconds"}
          </p>
        </div>
      </Card>
    </Link>
  );
}
