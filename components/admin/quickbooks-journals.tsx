"use client";
import { useState } from "react";
import type { listQuickbooksCostJournals } from "@/lib/services/quickbooks-cost-journals";
import type { reviewOrderCost } from "@/lib/services/quickbooks-cost-source";
type Data = Awaited<ReturnType<typeof listQuickbooksCostJournals>>;
async function response(init?: RequestInit, cursor?: string) {
  const r = await fetch(
      "/api/admin/quickbooks/journals" +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      init,
    ),
    data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Cost journal could not be confirmed.");
  return data;
}
const post = (data: unknown) =>
  response({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
export function PrepareCostJournal({
  source,
}: {
  source: Awaited<ReturnType<typeof reviewOrderCost>>;
}) {
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [key, setKey] = useState(""),
    [saved, setSaved] = useState("");
  async function prepare() {
    setBusy(true);
    setError("");
    const requestKey = key || crypto.randomUUID();
    setKey(requestKey);
    try {
      const result = await post({
        action: "prepare",
        orderId: source.orderId,
        ...(source.kind === "RETURN" ? { returnId: source.sourceId } : {}),
        confirmed: true,
        requestKey,
      });
      setSaved(result.docNumber);
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cost journal could not be prepared.");
    } finally {
      setBusy(false);
    }
  }
  if (source.amountCents === 0) return <p>No cost journal is needed for this source.</p>;
  return (
    <div className="space-y-3">
      <p>
        A draft preserves this recorded cost and its account mapping. Returns use the
        posted original sale&apos;s accounts.
      </p>
      {saved ? (
        <p role="status">
          Cost journal draft {saved} saved. Load cost journals below to review it.
        </p>
      ) : (
        <>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed this cost source and want to prepare its journal draft.
          </label>
          <button className="ops-button" disabled={!confirmed || busy} onClick={prepare}>
            Prepare cost journal
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function JournalRow({
  row,
  canWrite,
  canSubmit,
  reload,
}: {
  row: Data["rows"][number];
  canWrite: boolean;
  canSubmit: boolean;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [attempted, setAttempted] = useState(false);
  async function act(action: "submit" | "cancel" | "reconcile") {
    setBusy(true);
    setError("");
    if (action === "submit") setAttempted(true);
    try {
      await post({ action, id: row.id, confirmed: true });
      setConfirmed(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cost journal could not be confirmed.");
      if (action === "submit") await reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-3 rounded border p-4">
      <h3 className="font-semibold">
        {row.source.number} ·{" "}
        {row.source.kind === "SALE" ? "Sale cost" : "Inventory return"}
      </h3>
      <p>
        {row.source.date} · USD {(row.source.amountCents / 100).toFixed(2)}
      </p>
      <p>
        Journal: {row.status.toLowerCase()} · Reference {row.docNumber}
      </p>
      <p>
        Company {row.realm} · {row.mapping.costAccount.name} ·{" "}
        {row.mapping.inventoryAccount.name}
      </p>
      {row.externalId && <p>QuickBooks journal {row.externalId}</p>}
      {row.reconciliationIssue && (
        <p role="alert">
          Journal evidence needs accounting review. Its saved reference remains protected.
        </p>
      )}
      {["SUBMITTING", "UNKNOWN"].includes(row.status) && (
        <p>
          Submission is unconfirmed. Reconcile its receipt before taking further
          accounting action.
        </p>
      )}
      {canWrite &&
        row.status !== "CANCELED" &&
        (row.status !== "POSTED" || row.reconciliationIssue) && (
          <>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed this journal and its company.
            </label>
            <div className="flex flex-wrap gap-3">
              {row.status === "DRAFT" ? (
                <>
                  <button
                    className="ops-button"
                    disabled={busy || !confirmed || !canSubmit || attempted}
                    onClick={() => act("submit")}
                  >
                    Submit cost journal
                  </button>
                  <button
                    className="ops-button"
                    disabled={busy || !confirmed || attempted}
                    onClick={() => act("cancel")}
                  >
                    Cancel journal draft
                  </button>
                </>
              ) : (
                <button
                  className="ops-button"
                  disabled={busy || !confirmed}
                  onClick={() => act("reconcile")}
                >
                  Reconcile cost journal
                </button>
              )}
            </div>
            {attempted && row.status === "DRAFT" && (
              <p>
                Submission was attempted. Refresh journal status before taking another
                action.
              </p>
            )}
          </>
        )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
export function QuickbooksJournals() {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(more = false) {
    setBusy(true);
    setError("");
    try {
      const result: Data = await response(
        undefined,
        more ? (data?.nextCursor ?? undefined) : undefined,
      );
      setData((old) =>
        more && old
          ? {
              ...result,
              rows: [
                ...old.rows,
                ...result.rows.filter((r) => !old.rows.some((p) => p.id === r.id)),
              ],
            }
          : result,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cost journals could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Cost journal exports</h2>
      <p>
        Review prepared sale costs and sellable inventory returns. An unconfirmed
        submission stays blocked from another send.
      </p>
      <button className="ops-button" disabled={busy} onClick={() => load()}>
        Load cost journals
      </button>
      {data && (
        <>
          <p>
            New journal submissions:{" "}
            {data.canSubmit ? "enabled for this company" : "disabled"}
          </p>
          {!data.rows.length && <p>No cost journal exports have been prepared.</p>}
          {data.rows.map((row) => (
            <JournalRow
              key={row.id + ":" + row.status}
              row={row}
              canWrite={data.canWrite}
              canSubmit={data.canSubmit}
              reload={() => load()}
            />
          ))}
          {data.nextCursor && data.rows.length < 500 && (
            <button className="ops-button" disabled={busy} onClick={() => load(true)}>
              Load more cost journals
            </button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
