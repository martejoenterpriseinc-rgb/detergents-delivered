"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
type Row = {
  id: string;
  decision: string;
  canApprove: boolean;
  providerCase: string;
  evidenceReference: string;
  evidenceSha256: string;
  statement: string;
  reviewedThrough: string;
  decisionReason: string | null;
};
export function FinancialClaimReview({
  kind,
  claimId,
}: {
  kind: "TIP_REFUND" | "MANUAL_REFUND_TAX" | "MANUAL_CHECKOUT_TAX";
  claimId: string;
}) {
  const router = useRouter(),
    pending = useRef<{ method: "POST" | "PATCH"; body: string } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    const r = await fetch(
        `/api/admin/financial-claim-reviews?kind=${kind}&claimId=${encodeURIComponent(claimId)}`,
      ),
      d = await r.json();
    if (!r.ok) throw Error(d.error ?? "Could not load reviews.");
    setRows(d.rows);
  }
  async function send(method: "POST" | "PATCH", body: Record<string, unknown>) {
    pending.current ??= { method, body: JSON.stringify(body) };
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin/financial-claim-reviews", {
          method: pending.current.method,
          headers: { "Content-Type": "application/json" },
          body: pending.current.body,
        }),
        d = await r.json();
      if (r.status >= 400 && r.status < 500) pending.current = null;
      if (!r.ok) throw Error(d.error ?? "Review could not be saved.");
      pending.current = null;
      setMessage(`Review ${d.decision}.`);
      await load();
      router.refresh();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Response uncertain. Retry the same review action.",
      );
    } finally {
      setBusy(false);
      setUncertain(pending.current !== null);
    }
  }
  async function propose(form: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const file = form.get("evidence") as File;
      if (!file?.size || file.size > 10 * 1024 * 1024)
        throw Error("Choose the retained provider confirmation file, up to 10 MB.");
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
      )
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      await send("POST", {
        kind,
        claimId,
        requestKey: crypto.randomUUID(),
        providerCase: form.get("providerCase"),
        evidenceReference: form.get("evidenceReference"),
        evidenceSha256: hash,
        statement: form.get("statement"),
        reviewedThrough: new Date(String(form.get("reviewedThrough"))).toISOString(),
        confirmed: form.get("confirmed") === "on",
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Review needs attention.");
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded border p-3 break-words">
      <h3 className="font-semibold">Provider non-creation review</h3>
      <p>
        Use only for a claim older than 24 hours. A provider confirmation must identify
        the original account and request and confirm no transaction was created. Empty
        searches are insufficient.
      </p>
      <button
        type="button"
        className="ops-button"
        disabled={busy || uncertain}
        onClick={async () => {
          setBusy(true);
          try {
            await load();
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Could not load reviews.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Load claim reviews
      </button>
      {rows && (
        <>
          {rows.map((r) => (
            <article key={r.id} className="space-y-2 rounded border p-3">
              <p>
                {r.decision} · Provider case {r.providerCase}
              </p>
              <p>Retained evidence: {r.evidenceReference}</p>
              <p>File SHA-256: {r.evidenceSha256}</p>
              <p>{r.statement}</p>
              <p>Provider confirmation covers through {r.reviewedThrough}</p>
              {r.decisionReason && <p>{r.decisionReason}</p>}
              {r.decision === "PENDING" && (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void send("PATCH", {
                      id: r.id,
                      decision: f.get("decision"),
                      reason: f.get("reason"),
                      confirmed: f.get("confirmed") === "on",
                    });
                  }}
                >
                  <fieldset disabled={busy || uncertain} className="space-y-2">
                    <label className="block">
                      Review decision
                      <select
                        name="decision"
                        aria-label="Review decision"
                        defaultValue={r.canApprove ? "APPROVED" : "REJECTED"}
                        className="block w-full rounded border p-3"
                      >
                        <option value="APPROVED" disabled={!r.canApprove}>
                          Approve provider evidence
                        </option>
                        <option value="REJECTED">Reject or withdraw proposal</option>
                      </select>
                    </label>
                    {!r.canApprove && (
                      <p>A different finance administrator must approve your proposal.</p>
                    )}
                    <label className="block">
                      Decision reason
                      <textarea
                        name="reason"
                        minLength={10}
                        maxLength={1000}
                        required
                        className="block w-full rounded border p-3"
                      />
                    </label>
                    <label className="flex gap-2">
                      <input name="confirmed" type="checkbox" required />I independently
                      checked the retained evidence and its file hash for approval, or
                      recorded why the proposal is rejected.
                    </label>
                  </fieldset>
                  <button className="ops-button" disabled={busy || uncertain}>
                    Save review decision
                  </button>
                </form>
              )}
            </article>
          ))}
          {!rows.some((r) => r.decision === "APPROVED") && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void propose(new FormData(e.currentTarget));
              }}
            >
              <fieldset disabled={busy || uncertain} className="space-y-3">
                <label className="block">
                  Provider support case or request-log reference
                  <input
                    name="providerCase"
                    minLength={5}
                    maxLength={160}
                    required
                    className="block w-full rounded border p-3"
                  />
                </label>
                <label className="block">
                  Retained evidence location or document reference
                  <input
                    name="evidenceReference"
                    minLength={10}
                    maxLength={500}
                    required
                    className="block w-full rounded border p-3"
                  />
                </label>
                <label className="block">
                  Retained provider confirmation file
                  <input type="file" name="evidence" required className="block w-full" />
                </label>
                <p>
                  The file stays in your retained evidence location. Its fingerprint is
                  saved for the second reviewer to compare.
                </p>
                <label className="block">
                  Provider confirmation covers through (your local time)
                  <input
                    type="datetime-local"
                    name="reviewedThrough"
                    required
                    className="block w-full rounded border p-3"
                  />
                </label>
                <label className="block">
                  Evidence summary
                  <textarea
                    name="statement"
                    minLength={30}
                    maxLength={2000}
                    required
                    className="block w-full rounded border p-3"
                  />
                </label>
                <label className="flex gap-2">
                  <input type="checkbox" name="confirmed" required />
                  The provider confirms this exact request was never created. All original
                  attempts have ended; no request is still in flight. I retained the
                  confirmation for independent review.
                </label>
              </fieldset>
              <button className="ops-button" disabled={busy || uncertain}>
                Propose non-creation review
              </button>
            </form>
          )}
          {rows.some((r) => r.decision === "APPROVED") && (
            <p>
              {kind === "TIP_REFUND"
                ? "The original claim remains recorded and monitored. Submit any later refund as a separate, deliberate request."
                : "Use the reviewed retry option to submit the original tax reference. This approval does not itself create tax or return money."}
            </p>
          )}
        </>
      )}
      {uncertain && (
        <button
          type="button"
          className="ops-button"
          disabled={busy}
          onClick={() => send(pending.current!.method, {})}
        >
          Retry same review action
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
