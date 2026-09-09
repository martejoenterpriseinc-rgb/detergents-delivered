"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { formatCents } from "@/lib/domain/money";
import type { getLoyalty } from "@/lib/services/loyalty";
type Data = Awaited<ReturnType<typeof getLoyalty>>;
const date = (v: Date | string) =>
  new Date(v).toLocaleDateString("en-US", { timeZone: "America/Chicago" });
const button =
  "min-h-11 rounded-full bg-teal-700 px-5 py-2 font-semibold text-white disabled:opacity-50";
export function LoyaltyCustomer({ initial }: { initial: Data }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function mutate(payload: object) {
    const response = await fetch("/api/account/loyalty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    const refresh = await fetch("/api/account/loyalty", { cache: "no-store" });
    if (!refresh.ok)
      throw new Error(
        "Your change may be saved, but the updated view could not be loaded. Refresh before retrying.",
      );
    setData(await refresh.json());
    router.refresh();
  }
  async function share(link: Data["links"][number], method: "COPY" | "SHARE") {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const url = `${window.location.origin}/r/${link.token}`;
      if (method === "COPY") await navigator.clipboard.writeText(url);
      else if (navigator.share)
        await navigator.share({
          title: "Detergents Delivered referral",
          text: "Join me at Detergents Delivered",
          url,
        });
      else throw new Error("Sharing is not available in this browser. Use Copy link.");
      await mutate({ action: "shared", id: link.id, method });
      setMessage(
        method === "COPY"
          ? "Link copied. You can paste it into a message."
          : "Share action recorded. Recipient delivery cannot be confirmed here.",
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(e instanceof Error ? e.message : "Sharing could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm">Available rewards</p>
          <p className="mt-2 text-2xl font-semibold" data-testid="reward-balance">
            {formatCents(data.balance.availableCents)}
          </p>
        </Card>
        <Card>
          <p className="text-sm">Earned from referrals</p>
          <p className="mt-2 text-2xl font-semibold">{formatCents(data.earnedCents)}</p>
        </Card>
        <Card>
          <p className="text-sm">Reserved for checkout</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatCents(data.balance.heldCents)}
          </p>
        </Card>
      </div>
      {data.balance.balanceCents < 0 && (
        <p role="alert" className="rounded-2xl bg-amber-50 p-4">
          A qualifying purchase was refunded. Future earnings cover{" "}
          {formatCents(-data.balance.balanceCents)} before rewards become available again.
        </p>
      )}
      <Card className="space-y-3">
        <h2 className="text-xl font-semibold">Invite a neighbor</h2>
        <p>
          {data.config.enabled
            ? `Earn ${formatCents(data.config.referrerRewardCents)} after their first qualifying paid order. They earn ${formatCents(data.config.friendRewardCents)} for a future order.`
            : "The referral program is paused. Existing earned rewards remain on your account."}
        </p>
        <p className="text-sm text-teal-700">
          Minimum merchandise purchase: {formatCents(data.config.minimumPurchaseCents)}.
          One verified new customer per link. Links expire after{" "}
          {data.config.linkExpiryDays} days. Refunds or cancellations reverse referral
          rewards.
        </p>
        {!data.verified && (
          <p className="text-sm text-amber-800">
            A verified email is required to create or claim referrals. Contact support if
            verification is unavailable.
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            setError("");
            const requestKey = key || crypto.randomUUID();
            setKey(requestKey);
            try {
              await mutate({ action: "create", label, requestKey });
              setLabel("");
              setKey("");
              setMessage("Referral link created. Copy or share it below.");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Link could not be created.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="min-w-0 flex-1 text-sm font-semibold">
            Label for your records
            <input
              required
              maxLength={60}
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setKey("");
              }}
              placeholder="For example: neighbor on Oak Street"
              className="mt-1 w-full rounded-xl border border-teal-200 p-3 font-normal"
            />
          </label>
          <button
            className={button}
            disabled={busy || !data.customer || !data.verified || !data.config.enabled}
          >
            Create referral link
          </button>
        </form>
      </Card>
      {error && (
        <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-rose-900">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-2xl bg-teal-100 p-4">
          {message}
        </p>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your referral links</h2>
        <p className="text-sm text-teal-700">
          Latest 100 links. Copy/share records show your action, not proof that a message
          was sent or read.
        </p>
        {!data.links.length && <Card>No referral links yet.</Card>}
        {data.links.map((link) => (
          <Card key={link.id} className="space-y-3">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-semibold break-words">{link.label}</h3>
              <span className="rounded-full bg-teal-50 px-3 py-1 text-sm">
                {link.referral?.status === "REWARDED"
                  ? "Reward earned"
                  : link.referral?.status === "REVERSED"
                    ? "Reward reversed"
                    : link.referral
                      ? "Claimed · awaiting qualifying purchase"
                      : new Date(link.expiresAt) <= new Date()
                        ? "Expired"
                        : link.sharedAt
                          ? "Share action recorded"
                          : link.copiedAt
                            ? "Link copied"
                            : "Link created"}
              </span>
            </div>
            <p className="text-xs text-teal-700">
              Created {date(link.createdAt)} · Expires {date(link.expiresAt)}
            </p>
            <p className="rounded-xl bg-teal-50 p-3 text-sm break-all">/r/{link.token}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={button}
                disabled={
                  busy || Boolean(link.referral) || new Date(link.expiresAt) <= new Date()
                }
                onClick={() => share(link, "COPY")}
              >
                Copy link
              </button>
              <button
                type="button"
                className={button}
                disabled={
                  busy || Boolean(link.referral) || new Date(link.expiresAt) <= new Date()
                }
                onClick={() => share(link, "SHARE")}
              >
                Share link
              </button>
            </div>
          </Card>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Rewards activity</h2>
        <p className="text-sm text-teal-700">
          Dollar credits, not points. Latest 100 entries; used credits and reversals
          remain in your history.
        </p>
        {!data.entries.length && <Card>No rewards earned or used yet.</Card>}
        {data.entries.map((item) => (
          <Card key={item.id}>
            <div className="flex justify-between gap-3">
              <p>{item.description}</p>
              <strong className="whitespace-nowrap">
                {formatCents(item.amountCents)}
              </strong>
            </div>
            <p className="mt-2 text-xs text-teal-700">
              {date(item.createdAt)}
              {item.order ? ` · ${item.order.number}` : ""}
            </p>
          </Card>
        ))}
      </section>
    </div>
  );
}
export function ClaimReferral({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <button
        className={button}
        disabled={busy || Boolean(message)}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch("/api/account/loyalty", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "claim", token }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            setMessage(
              "Referral linked. Rewards are earned only after a qualifying paid first purchase.",
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "Referral could not be linked.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Claim referral
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
