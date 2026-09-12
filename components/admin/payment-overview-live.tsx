"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/domain/money";
type Health = {
  connected: boolean;
  message: string;
  checkedAt: string;
  availableCents: number | null;
  pendingCents: number | null;
};
export function PaymentOverviewLive({
  balances = false,
  provider = "stripe",
}: {
  balances?: boolean;
  provider?: "stripe" | "quickbooks";
}) {
  const providerName = provider === "stripe" ? "Stripe" : "QuickBooks";
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let stopped = false,
      pending = false;
    let controller: AbortController | undefined;
    async function check() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      setBusy(true);
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const r = await fetch(
          provider === "stripe"
            ? "/api/admin/payments/connection"
            : "/api/admin/quickbooks/health",
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!r.ok) throw Error();
        const next: Health = await r.json();
        if (!stopped) setHealth(next);
      } catch {
        if (!stopped)
          setHealth({
            connected: false,
            message: "Connection check failed. Retry or review Integrations.",
            checkedAt: new Date().toISOString(),
            availableCents: null,
            pendingCents: null,
          });
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (!stopped) setBusy(false);
      }
      if (!stopped) router.refresh();
    }
    void check();
    const timer = setInterval(() => void check(), 60000);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", check);
    };
  }, [router, revision, provider]);
  return (
    <section
      className="space-y-3 rounded-2xl border bg-white p-5"
      aria-label={`${providerName} API connection`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="status">
          <span
            aria-hidden="true"
            className={`mr-2 inline-block h-3 w-3 rounded-full ${health?.connected ? "bg-green-600" : "bg-red-600"}`}
          />
          <strong>
            {health?.connected
              ? "Connected"
              : health
                ? "Not connected"
                : "Checking connection…"}
          </strong>
          <p className="mt-1 text-sm">
            {health?.message ?? `Verifying the ${providerName} API for this environment.`}
          </p>
          {health && (
            <p className="mt-1 text-xs">
              Last check: {new Date(health.checkedAt).toLocaleTimeString()} · Refreshes
              every minute
            </p>
          )}
        </div>
        <button
          className="ops-button"
          disabled={busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          {busy ? "Checking…" : "Refresh payments"}
        </button>
      </div>
      {balances && (
        <div className="grid gap-4 sm:grid-cols-2">
          <p>
            Available USD balance{" "}
            <strong className="block text-2xl">
              {health?.availableCents == null
                ? "Unavailable"
                : formatCents(health.availableCents)}
            </strong>
          </p>
          <p>
            Pending USD balance{" "}
            <strong className="block text-2xl">
              {health?.pendingCents == null
                ? "Unavailable"
                : formatCents(health.pendingCents)}
            </strong>
          </p>
          <p className="text-sm sm:col-span-2">
            Current Stripe account balances, across the account; not restricted to the
            selected period or DetergentsDelivered orders.
          </p>
        </div>
      )}
    </section>
  );
}
