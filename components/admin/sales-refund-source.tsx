"use client";
import { useState } from "react";
import { PrepareReceiptDraft } from "./quickbooks-receipts";
import type {
  salesRefundChoices,
  reviewSalesRefundSource,
} from "@/lib/services/sales-refund-source";
type Data = Awaited<ReturnType<typeof salesRefundChoices>>;
export function SalesRefundSource() {
  const [data, setData] = useState<Data | null>(null),
    [order, setOrder] = useState(""),
    [adjustment, setAdjustment] = useState(""),
    [source, setSource] = useState<Awaited<
      ReturnType<typeof reviewSalesRefundSource>
    > | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function request(query: string) {
    const r = await fetch("/api/admin/quickbooks/sale-sources" + query),
      v = await r.json();
    if (!r.ok) throw new Error(v.error ?? "Accounting evidence could not be loaded.");
    return v;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Accounting evidence could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function load(more = false) {
    await run(async () => {
      const result: Data = await request(
        more && data?.nextCursor ? "?cursor=" + encodeURIComponent(data.nextCursor) : "",
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
      if (!more) {
        setOrder("");
        setAdjustment("");
        setSource(null);
      }
    });
  }
  const selected = data?.rows.find((r) => r.id === order);
  const money = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      v / 100,
    );
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Sales and refund evidence</h2>
      <p>
        Review saved sale amounts, tax and reward adjustments before receipt export.
        Unmatched refund tax evidence requires further review.
      </p>
      <button className="ops-button" disabled={busy} onClick={() => load()}>
        Load sales and refunds
      </button>
      {data && (
        <>
          <label className="block">
            Accounting order
            <select
              aria-label="Accounting order"
              className="mt-1 block w-full rounded border p-2"
              disabled={busy}
              value={order}
              onChange={(e) => {
                setOrder(e.target.value);
                setAdjustment("");
                setSource(null);
              }}
            >
              <option value="">Choose a paid order</option>
              {data.rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number}
                </option>
              ))}
            </select>
          </label>
          {!data.rows.length && <p>No paid orders are available.</p>}
          {selected && (
            <>
              <label className="block">
                Accounting entry
                <select
                  aria-label="Accounting entry"
                  className="mt-1 block w-full rounded border p-2"
                  disabled={busy}
                  value={adjustment}
                  onChange={(e) => {
                    setAdjustment(e.target.value);
                    setSource(null);
                  }}
                >
                  <option value="">Original paid sale</option>
                  {selected.adjustments.map((a, i) => (
                    <option key={a.id} value={a.id}>
                      {a.kind.replaceAll("_", " ").toLowerCase()} {i + 1} ·{" "}
                      {new Date(a.date).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </label>
              {selected.moreRefunds && (
                <p>
                  The latest 100 refund requests are listed. Older entries need individual
                  review.
                </p>
              )}
              <button
                className="ops-button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setSource(null);
                    setSource(
                      await request(
                        "?orderId=" +
                          encodeURIComponent(order) +
                          (adjustment
                            ? "&adjustmentId=" + encodeURIComponent(adjustment)
                            : ""),
                      ),
                    );
                  })
                }
              >
                Review accounting evidence
              </button>
            </>
          )}
          {data.nextCursor && data.rows.length < 500 && (
            <button className="ops-button" disabled={busy} onClick={() => load(true)}>
              Load more accounting orders
            </button>
          )}
          {data.nextCursor && data.rows.length >= 500 && (
            <p>
              The first 500 orders are loaded. Older orders need individual accounting
              review.
            </p>
          )}
        </>
      )}
      {source && (
        <article className="space-y-3 rounded border p-4">
          <h3 className="font-semibold">
            {source.number} · {source.kind.replaceAll("_", " ").toLowerCase()}
          </h3>
          <p>Recorded business date: {source.date}</p>
          <dl className="grid grid-cols-2 gap-2">
            <dt>Cash amount</dt>
            <dd>{money(source.cashCents)}</dd>
            <dt>Net merchandise</dt>
            <dd>{money(source.netCents)}</dd>
            <dt>Recorded tax</dt>
            <dd>{money(source.taxCents)}</dd>
            {source.kind === "SALE" ? (
              <>
                <dt>Promotion discount</dt>
                <dd>{money(source.promotionCents)}</dd>
                <dt>Rewards used</dt>
                <dd>{money(source.rewardsCents)}</dd>
              </>
            ) : (
              <>
                <dt>Reward adjustment</dt>
                <dd>{money(source.rewardCents)}</dd>
              </>
            )}
          </dl>
          {source.kind === "SALE" ? (
            <p>Amounts match the saved checkout and verified payment evidence.</p>
          ) : (
            <>
              <p>
                Refund tax evidence:{" "}
                {source.taxEvidenceStatus.toLowerCase().replaceAll("_", " ")}
              </p>
              {source.taxEvidenceStatus === "UNVERIFIED" && (
                <p role="alert">
                  Tax evidence is not matched. This entry is not ready for receipt export.
                </p>
              )}
              {source.kind === "COMPENSATION" && (
                <p>
                  Negative amounts offset the earlier refund. The original settlement
                  remains in the record.
                </p>
              )}
              {!source.requiresCashReceipt && (
                <p>
                  This entry restores rewards without a cash refund. No cash receipt is
                  needed.
                </p>
              )}
            </>
          )}
          <p>Reviewing this evidence does not send money or post to QuickBooks.</p>
          {data?.canWrite &&
            source.cashCents > 0 &&
            (source.kind === "SALE" ||
              (source.kind === "SETTLEMENT" &&
                source.taxEvidenceStatus === "MATCHED")) && (
              <PrepareReceiptDraft
                key={order + ":" + adjustment}
                orderId={order}
                adjustmentId={adjustment || undefined}
              />
            )}
        </article>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
