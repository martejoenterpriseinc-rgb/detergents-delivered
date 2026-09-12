"use client";
import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { ManualPaymentApprovalsData } from "@/lib/services/manual-payment-approvals";
function ApprovalForm({
  data,
  approval,
}: {
  data: ManualPaymentApprovalsData;
  approval: ManualPaymentApprovalsData["approvals"][number];
}) {
  const pathname = usePathname();
  const pending = useRef<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const label = approval.method === "CASH" ? "Cash" : "Zelle";
  async function save(form: FormData) {
    setBusy(true);
    setError("");
    try {
      if (!pending.current) {
        const amount = String(form.get("amount") ?? "");
        if (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(amount))
          throw Error("Enter a dollar amount with at most two decimal places.");
        const [dollars, cents = ""] = amount.split(".");
        pending.current = JSON.stringify({
          customerId: data.customerId,
          method: approval.method,
          version: approval.version,
          requestKey: crypto.randomUUID(),
          enabled: form.get("enabled") === "true",
          maxOrderCents: Number(dollars) * 100 + Number(cents.padEnd(2, "0")),
          expiresAt: new Date(
            Date.now() + Number(form.get("days")) * 86400000,
          ).toISOString(),
          reason: String(form.get("reason")),
        });
      }
      const r = await fetch("/api/admin/manual-payment-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: pending.current,
      });
      if (r.status >= 400 && r.status < 500) {
        pending.current = null;
        setUncertain(false);
      }
      const body = await r.json();
      if (!r.ok) throw Error(body.error ?? "Approval could not be confirmed.");
      pending.current = null;
      setUncertain(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save not confirmed.");
      setUncertain(Boolean(pending.current));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-4 rounded-2xl border bg-white p-5"
      aria-label={`${label} approval`}
    >
      <h2 className="text-xl font-semibold">{label}</h2>
      <p>
        Saved status:{" "}
        {approval.active ? "Approved" : approval.enabled ? "Expired" : "Not approved"} ·
        Revision {approval.version}
      </p>
      {approval.version > 0 && (
        <p>
          Limit ${(approval.maxOrderCents / 100).toFixed(2)} per order · Expires{" "}
          {approval.expiresAt?.slice(0, 10)} (UTC)
        </p>
      )}
      {saved ? (
        <p role="status">
          {label} approval saved.{" "}
          <a className="underline" href={pathname}>
            Reload approvals
          </a>
        </p>
      ) : (
        data.canWrite && (
          <form action={save} className="space-y-4">
            <fieldset disabled={busy || uncertain} className="space-y-4">
              <label className="block">
                {label} decision
                <select
                  name="enabled"
                  defaultValue={data.eligible ? "true" : "false"}
                  className="mt-1 block w-full rounded-lg border p-3"
                >
                  <option value="true" disabled={!data.eligible}>
                    Approve
                  </option>
                  {approval.version > 0 && <option value="false">Revoke</option>}
                </select>
              </label>
              <label className="block">
                {label} maximum per order (USD)
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  defaultValue={(approval.maxOrderCents / 100).toFixed(2)}
                  className="mt-1 block w-full rounded-lg border p-3"
                />
              </label>
              <label className="block">
                {label} approval duration
                <select
                  name="days"
                  defaultValue="30"
                  className="mt-1 block w-full rounded-lg border p-3"
                >
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                </select>
              </label>
              <label className="block">
                {label} reason
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={500}
                  className="mt-1 block w-full rounded-lg border p-3"
                />
              </label>
            </fieldset>
            {error && (
              <p role="alert" aria-label={`${label} approval error`}>
                {error}
              </p>
            )}
            {uncertain && (
              <p>
                The save may have completed. Retry the same request or{" "}
                <a className="underline" href={pathname}>
                  reload saved approvals
                </a>{" "}
                before changing it.
              </p>
            )}
            <button
              disabled={busy || (!data.eligible && approval.version === 0)}
              className="ops-button"
            >
              {busy
                ? "Saving…"
                : uncertain
                  ? `Retry ${label} approval`
                  : `Save ${label} approval`}
            </button>
          </form>
        )
      )}
    </section>
  );
}
export function ManualPaymentApprovals({ data }: { data: ManualPaymentApprovalsData }) {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold">Cash and Zelle approvals</h1>
      <p>{data.name}</p>
      <p>
        Approval permits a payment exception up to the saved limit. It does not confirm
        receipt of money, reserve products or delivery space, or change an order’s payment
        status.
      </p>
      {!data.eligible && (
        <p role="alert">
          The customer needs verified email and purchase approval before a new payment
          exception can be approved.
        </p>
      )}
      {!data.canWrite && <p>CPA access is read-only.</p>}
      {data.approvals.map((a) => (
        <ApprovalForm key={a.method + ":" + a.version} data={data} approval={a} />
      ))}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Recent approval history</h2>
        <p>
          Latest 20 decisions. Every decision retains its reason and staff audit record.
        </p>
        {!data.history.length && <p>No decisions recorded.</p>}
        {data.history.map((h, i) => (
          <article key={i} className="rounded-xl border p-3">
            <p>
              {h.at.replace("T", " ").slice(0, 19)} UTC · {h.method} ·{" "}
              {h.enabled ? "Approved" : "Revoked"}
            </p>
            <p className="break-words">{h.reason}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
