"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { adminFetch, AdminRequestError } from "@/lib/admin-fetch";
import {
  subscriptionConsent,
  subscriptionConsentVersion,
} from "@/lib/domain/subscriptions";
import type { readSubscriptions } from "@/lib/services/subscriptions";
import { Button } from "@/components/ui/button";

export function SubscriptionManager({
  data,
}: {
  data: Awaited<ReturnType<typeof readSubscriptions>>;
}) {
  const router = useRouter();
  const pending = useRef<object | null>(null);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    id: string;
    version: number;
    action: "pause" | "resume" | "skip" | "cancel";
  } | null>(null);
  async function save(payload: object) {
    if (busy) return;
    setBusy(true);
    setError("");
    pending.current ??= payload;
    try {
      await adminFetch("/api/account/subscriptions", {
        method: "POST",
        body: JSON.stringify(pending.current),
      });
      pending.current = null;
      setUncertain(false);
      setConfirmation(null);
      router.refresh();
    } catch (e) {
      const rejected =
        e instanceof AdminRequestError && e.status >= 400 && e.status < 500;
      if (rejected) pending.current = null;
      setUncertain(!rejected);
      setError(
        e instanceof Error ? e.message : "Subscription save could not be confirmed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    pause: "Pause",
    resume: "Resume",
    skip: "Skip next quarter",
    cancel: "Cancel subscription",
  };
  return (
    <div className="space-y-6">
      <p>
        Every three calendar months. Review and pay for each purchase; there are no
        automatic charges. Scheduling does not reserve stock or a delivery date.
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {uncertain && (
        <div className="space-y-2">
          <p>
            The save result is unconfirmed. Retry the same change before making another.
          </p>
          <Button disabled={busy} onClick={() => void save(pending.current!)}>
            Retry same subscription change
          </Button>
        </div>
      )}
      {data.canCreate && data.orders.length > 0 && (
        <form
          className="space-y-4 rounded-xl border bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void save({
              kind: "create",
              data: {
                requestKey: crypto.randomUUID(),
                originOrderId: String(form.get("originOrderId")),
                accepted: true,
                consentVersion: subscriptionConsentVersion,
              },
            });
          }}
        >
          <h2 className="text-xl font-semibold">Start a quarterly subscription</h2>
          <fieldset disabled={busy || uncertain} className="space-y-4">
            <label className="grid gap-1">
              Repeat products from a paid order
              <select
                name="originOrderId"
                required
                className="w-full min-w-0 rounded-lg border p-2"
              >
                {data.orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" required className="mt-1" />
              {subscriptionConsent}
            </label>
            <Button type="submit">Start quarterly subscription</Button>
          </fieldset>
        </form>
      )}
      {!data.subscriptions.length && (
        <p>
          No subscriptions yet. After a verified paid purchase, you can repeat those
          products quarterly here.
        </p>
      )}
      {confirmation && (
        <section
          aria-label="Confirm subscription change"
          className="space-y-3 rounded-xl border border-teal-300 bg-teal-50 p-4"
        >
          <h2 className="font-semibold">{labels[confirmation.action]}</h2>
          <p>
            This affects future quarters. Existing purchases and deliveries remain in your
            order history. Resuming skips past dates without charging for missed quarters.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || uncertain}
              onClick={() =>
                void save({
                  kind: "change",
                  data: { ...confirmation, requestKey: crypto.randomUUID() },
                })
              }
            >
              Confirm {labels[confirmation.action].toLowerCase()}
            </Button>
            <Button
              variant="outline"
              disabled={busy || uncertain}
              onClick={() => setConfirmation(null)}
            >
              Keep current schedule
            </Button>
          </div>
        </section>
      )}
      {data.subscriptions.map((s) => (
        <article key={s.id} className="space-y-3 rounded-xl border bg-white p-5">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="min-w-0 font-semibold break-all">
              {s.orderNumber ?? "Saved subscription"}
            </h2>
            <span>
              {s.status === "ACTIVE"
                ? "Active"
                : s.status === "PAUSED"
                  ? "Paused"
                  : s.status === "CANCELLED"
                    ? "Canceled"
                    : "Payment review needed"}
            </span>
          </div>
          <p>
            {s.quarterly
              ? "Every three calendar months"
              : "Older schedule — quarterly consent required before resuming"}
          </p>
          {s.status !== "CANCELLED" && s.nextDate && (
            <p>
              {s.status === "PAUSED" ? "Paused schedule date" : "Next quarter"}:{" "}
              {s.nextDate}
            </p>
          )}
          {s.due && (
            <p className="font-semibold text-teal-800">This quarter is due for review.</p>
          )}
          <ul>
            {s.items.map((i, n) => (
              <li key={n} className="break-words">
                {i.quantity} × {i.name}
              </li>
            ))}
          </ul>
          {s.status !== "CANCELLED" && (
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ...(s.status !== "PAUSED" ? ["pause"] : s.quarterly ? ["resume"] : []),
                  ...(s.status === "ACTIVE" && s.quarterly ? ["skip"] : []),
                  "cancel",
                ] as (keyof typeof labels)[]
              ).map((action) => (
                <Button
                  key={action}
                  variant="outline"
                  disabled={busy || uncertain}
                  onClick={() =>
                    setConfirmation({ id: s.id, version: s.version, action })
                  }
                >
                  {labels[action]}
                </Button>
              ))}
            </div>
          )}
        </article>
      ))}
      <Link href="/account" className="underline">
        Back to account
      </Link>
    </div>
  );
}
