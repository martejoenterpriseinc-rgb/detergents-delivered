"use client";
import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { readDeliveryTips } from "@/lib/services/delivery-tips";
type Data = Awaited<ReturnType<typeof readDeliveryTips>>;
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
export function DeliveryTip({ data }: { data: Data }) {
  const pathname = usePathname(),
    pending = useRef<string | null>(null);
  const [choice, setChoice] = useState("PERCENT"),
    [percent, setPercent] = useState("15"),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [saved, setSaved] = useState(false);
  async function request(decline = false) {
    setBusy(true);
    setError("");
    try {
      if (!pending.current) {
        const base = { orderId: data.orderId, requestKey: crypto.randomUUID() };
        if (decline) pending.current = JSON.stringify({ ...base, choice: "DECLINE" });
        else if (choice === "PERCENT")
          pending.current = JSON.stringify({ ...base, choice, percent: Number(percent) });
        else {
          if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(amount))
            throw Error("Enter a tip from $0.50 to $500.");
          const [d, c = ""] = amount.split(".");
          pending.current = JSON.stringify({
            ...base,
            choice,
            amountCents: Number(d) * 100 + Number(c.padEnd(2, "0")),
          });
        }
      }
      const r = await fetch("/api/account/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: pending.current,
      });
      if (r.status >= 400 && r.status < 500) {
        pending.current = null;
        setUncertain(false);
      }
      const result = await r.json();
      if (!r.ok) throw Error(result.error ?? "Tip could not be confirmed.");
      pending.current = null;
      setUncertain(false);
      if (result.url) window.location.assign(result.url);
      else setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tip could not be confirmed.");
      setUncertain(Boolean(pending.current));
    } finally {
      setBusy(false);
    }
  }
  async function check(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/account/tips", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error ?? "Payment check unavailable.");
      if (result.url) window.location.assign(result.url);
      else setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment check unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <h1 className="text-3xl font-semibold">Optional delivery tip</h1>
      <p className="break-words">Order {data.number}</p>
      <p>
        Tipping is optional. Your delivery and rewards are the same whether you leave a
        tip or decline.
      </p>
      <p>
        Percentages use the original merchandise total after discounts and rewards, before
        tax: {money(data.baseCents)}. Any applicable tip tax is shown before you confirm
        payment.
      </p>
      {!data.enabled && <p>Tip payments are not available yet.</p>}
      {error && (
        <p role="alert" aria-label="Tip request error">
          {error}
        </p>
      )}
      {saved ? (
        <p role="status">
          Your choice or payment check was saved.{" "}
          <a href={pathname} className="underline">
            Reload tip status
          </a>
        </p>
      ) : (
        data.canChoose && (
          <section className="space-y-4 rounded-2xl border bg-white p-5">
            <fieldset disabled={busy || uncertain || !data.enabled} className="space-y-3">
              <legend className="font-semibold">Choose a tip</legend>
              <label className="block">
                Tip type
                <select
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                  className="block w-full rounded-lg border p-3"
                >
                  <option value="PERCENT">Percentage</option>
                  <option value="AMOUNT">Dollar amount</option>
                </select>
              </label>
              {choice === "PERCENT" ? (
                <label className="block">
                  Tip percentage
                  <select
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                    className="block w-full rounded-lg border p-3"
                  >
                    {[5, 10, 15, 20].map((n) => (
                      <option key={n} value={n}>
                        {n}% — {money(Math.floor((data.baseCents * n + 50) / 100))}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block">
                  Tip amount (USD)
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="block w-full rounded-lg border p-3"
                  />
                </label>
              )}
            </fieldset>
            {uncertain ? (
              <>
                <p>
                  Your request may have completed. Retry the same request or reload its
                  status before changing the amount.
                </p>
                <button className="ops-button" disabled={busy} onClick={() => request()}>
                  Retry tip request
                </button>
                <a href={pathname} className="block underline">
                  Reload tip status
                </a>
              </>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button
                  className="ops-button"
                  disabled={busy || !data.enabled}
                  onClick={() => request()}
                >
                  Continue to tip payment
                </button>
                <button
                  className="ops-button secondary"
                  disabled={busy}
                  onClick={() => request(true)}
                >
                  No tip, thank you
                </button>
              </div>
            )}
          </section>
        )
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Tip status</h2>
        {!data.tips.length && <p>No tip selected.</p>}
        {data.tips.map((t) => (
          <article key={t.id} className="space-y-2 rounded-xl border p-4">
            <p>
              {t.state === "DECLINED"
                ? "Tip declined"
                : t.state === "PAID"
                  ? "Tip payment confirmed"
                  : t.state === "EXPIRED"
                    ? "Payment session expired"
                    : "Payment not confirmed"}
            </p>
            {t.state !== "DECLINED" && (
              <p>
                Tip: {money(t.amountCents)}
                {t.taxCents !== null && ` · Tax: ${money(t.taxCents)}`}
                {t.totalCents !== null && ` · Total: ${money(t.totalCents)}`}
              </p>
            )}
            {["OPEN", "SUBMITTING", "UNKNOWN"].includes(t.state) && (
              <button
                className="ops-button secondary"
                disabled={busy}
                onClick={() => check(t.id)}
              >
                Check or resume tip payment
              </button>
            )}
          </article>
        ))}
      </section>
      <a href="/account/deliveries" className="underline">
        Back to deliveries
      </a>
    </div>
  );
}
