"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { dollarsToCents } from "@/lib/domain/loyalty";
import type { programConfig } from "@/lib/services/loyalty";
const button =
  "min-h-11 rounded-full bg-teal-700 px-5 py-2 font-semibold text-white disabled:opacity-50";
export function ProgramSettings({
  initial,
}: {
  initial: Awaited<ReturnType<typeof programConfig>>;
}) {
  const router = useRouter();
  const [version, setVersion] = useState(initial.version);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4 rounded-3xl border border-teal-100 bg-white p-6 shadow-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setMessage("");
        try {
          const fd = new FormData(e.currentTarget);
          const data = {
            enabled: fd.get("enabled") === "on",
            referrerRewardCents: dollarsToCents(String(fd.get("referrer"))),
            friendRewardCents: dollarsToCents(String(fd.get("friend"))),
            minimumPurchaseCents: dollarsToCents(String(fd.get("minimum"))),
            linkExpiryDays: Number(fd.get("expiry")),
            maxReferralsPerCustomer: Number(fd.get("limit")),
            version,
          };
          const response = await fetch("/api/admin/loyalty", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          setVersion(result.version);
          setMessage(
            "Program settings saved. Existing referral reward terms and earned credits are preserved.",
          );
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Settings could not be saved.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-xl font-semibold">Program controls</h2>
      <label className="flex items-center gap-3 font-semibold">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={initial.enabled}
          className="h-5 w-5"
        />
        Enable new referrals
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          {
            name: "referrer",
            label: "Referrer reward ($)",
            value: (initial.referrerRewardCents / 100).toFixed(2),
          },
          {
            name: "friend",
            label: "Friend reward after first purchase ($)",
            value: (initial.friendRewardCents / 100).toFixed(2),
          },
          {
            name: "minimum",
            label: "Minimum merchandise purchase ($)",
            value: (initial.minimumPurchaseCents / 100).toFixed(2),
          },
          {
            name: "expiry",
            label: "New link expires after (days)",
            value: initial.linkExpiryDays,
          },
          {
            name: "limit",
            label: "Lifetime rewarded referrals per customer",
            value: initial.maxReferralsPerCustomer,
          },
        ].map((f) => (
          <label key={f.name} className="text-sm font-semibold">
            {f.label}
            <input
              required
              name={f.name}
              inputMode={typeof f.value === "number" ? "numeric" : "decimal"}
              defaultValue={f.value}
              className="mt-1 w-full rounded-xl border border-teal-200 p-3 font-normal"
            />
          </label>
        ))}
      </div>
      <p className="text-sm text-teal-700">
        Rewards are USD credits. A verified first paid purchase is required; tax and
        delivery do not count toward the minimum. Any refund or cancellation reverses the
        qualifying referral reward. Pausing prevents new claims and awards; it does not
        erase earned credits. Claimed reward amounts and minimums remain unchanged.
      </p>
      <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
        Review each eligible referral to process its reward. The review action requires
        verified payment records and never substitutes for collecting payment.
      </p>
      {error && (
        <p role="alert" className="text-rose-800">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button className={button} disabled={busy}>
        {busy ? "Saving…" : "Save program settings"}
      </button>
    </form>
  );
}
export function ReviewReferral({ id }: { id: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <button
        className={button}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setMessage("");
          try {
            const response = await fetch("/api/admin/loyalty", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ referralId: id }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            setMessage(
              result.status === "REVERSED"
                ? "Reward reversal recorded."
                : "Qualifying rewards recorded.",
            );
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Review could not be completed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Review qualifying purchase
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-800">
          {error}
        </p>
      )}
    </div>
  );
}
