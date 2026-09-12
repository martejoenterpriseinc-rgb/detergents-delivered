"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
export function TipRefundForm({
  tipId,
  enabled,
  requests,
}: {
  tipId: string;
  enabled: boolean;
  requests: {
    id: string;
    state: string;
    amountCents: number;
    providerRefundId: string | null;
    lastError: string | null;
  }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState("");
  const pending = useRef<Record<string, unknown> | null>(null);
  async function send(body: Record<string, unknown>, method: "POST" | "PATCH") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/tips/refunds", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        if (method === "POST" && response.status >= 400 && response.status < 500) {
          pending.current = null;
          setUncertain(false);
        }
        throw Error(result.error ?? "Refund could not be verified.");
      }
      pending.current = null;
      setUncertain(false);
      setMessage(
        `Refund request ${result.state}. Use Check refund to recover an uncertain result.`,
      );
      router.refresh();
    } catch (error) {
      if (method === "POST") setUncertain(Boolean(pending.current));
      setMessage(
        error instanceof Error
          ? error.message
          : "Refund response is uncertain. Retry the same request.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Refund this tip payment</h2>
      <p>
        Refunds go to the original payment method. The amount includes any refunded tax.
        Driver balances and tax evidence are reconciled separately.
      </p>
      {!enabled ? (
        <p>Tip refund submission is awaiting environment activation and acceptance.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending.current) {
              void send(pending.current, "POST");
              return;
            }
            const data = new FormData(event.currentTarget),
              amount = String(data.get("amount") ?? "");
            if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(amount)) {
              setMessage("Enter a valid refund amount with at most two decimal places.");
              return;
            }
            const [whole, fraction = ""] = amount.split(".");
            const body = {
              tipId,
              requestKey: crypto.randomUUID(),
              amountCents: Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
              reason: data.get("reason"),
              confirmed: data.get("confirmed") === "on",
            };
            pending.current = body;
            void send(body, "POST");
          }}
        >
          <fieldset disabled={busy || uncertain} className="space-y-3">
            <label className="block">
              Refund cash amount including tax ($)
              <input
                name="amount"
                required
                inputMode="decimal"
                className="mt-1 block w-full rounded border p-3"
              />
            </label>
            <label className="block">
              Reason
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={500}
                className="mt-1 block w-full rounded border p-3"
              />
            </label>
            <label className="flex gap-2">
              <input type="checkbox" name="confirmed" required />I confirm this refund
              amount and original payment.
            </label>
          </fieldset>
          <button className="ops-button" disabled={busy} type="submit">
            {uncertain ? "Retry same refund request" : "Submit tip refund"}
          </button>
        </form>
      )}
      {requests.some((r) => ["SUBMITTING", "UNKNOWN", "PENDING"].includes(r.state)) && (
        <p>
          Check the existing refund before submitting another refund or driver payout.
        </p>
      )}
      {requests.map((r) => (
        <article key={r.id} className="space-y-2 rounded border p-3 break-words">
          <p>
            ${(r.amountCents / 100).toFixed(2)} · {r.state}
          </p>
          <p>{r.providerRefundId ?? "Provider confirmation pending"}</p>
          {r.lastError && <p>Reconciliation required</p>}
          <button
            type="button"
            className="ops-button"
            disabled={busy}
            onClick={() => send({ id: r.id }, "PATCH")}
          >
            Check refund
          </button>
        </article>
      ))}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
