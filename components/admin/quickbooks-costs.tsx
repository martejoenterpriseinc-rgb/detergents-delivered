"use client";
import { PrepareCostJournal } from "./quickbooks-journals";
import { useState } from "react";
import type { QuickbooksAccount } from "@/lib/integrations/quickbooks-client";
import type { costMappingData } from "@/lib/services/quickbooks-cost-mapping";
import type {
  costOrderChoices,
  reviewOrderCost,
} from "@/lib/services/quickbooks-cost-source";
type Mapping = Awaited<ReturnType<typeof costMappingData>>;
type Orders = Awaited<ReturnType<typeof costOrderChoices>>;
export function QuickbooksCosts() {
  const [data, setData] = useState<Mapping | null>(null),
    [accounts, setAccounts] = useState<QuickbooksAccount[]>([]),
    [next, setNext] = useState<number | null>(null),
    [cost, setCost] = useState(""),
    [inventory, setInventory] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [requestKey, setRequestKey] = useState(""),
    [orders, setOrders] = useState<Orders | null>(null),
    [order, setOrder] = useState(""),
    [returned, setReturned] = useState(""),
    [source, setSource] = useState<Awaited<ReturnType<typeof reviewOrderCost>> | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function response(url: string, init?: RequestInit) {
    const r = await fetch(url, init),
      v = await r.json();
    if (!r.ok) throw new Error(v.error ?? "Cost accounting could not be loaded.");
    return v;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cost accounting failed.");
    } finally {
      setBusy(false);
    }
  }
  async function loadAccounts(more = false) {
    await run(async () => {
      const mapping: Mapping =
          more && data ? data : await response("/api/admin/quickbooks/costs"),
        result = await response(
          "/api/admin/quickbooks/accounts?start=" + (more ? next : 1),
        );
      if (mapping.realm !== result.realm)
        throw new Error("The company changed. Reload before saving.");
      setData(mapping);
      setAccounts((old) =>
        more
          ? [
              ...old,
              ...result.accounts.filter(
                (a: QuickbooksAccount) => !old.some((p) => p.Id === a.Id),
              ),
            ]
          : result.accounts,
      );
      setNext(result.nextStart);
      if (!more) {
        setCost("");
        setInventory("");
        setConfirmed(false);
        setRequestKey("");
      }
    });
  }
  async function save() {
    if (!data || !confirmed) return;
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    await run(async () => {
      const mapping = await response("/api/admin/quickbooks/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: key,
          costAccountId: cost,
          inventoryAccountId: inventory,
          version: data.mapping?.version ?? 0,
          confirmed: true,
        }),
      });
      setData({ ...data, mapping });
      setConfirmed(false);
      setRequestKey("");
    });
  }
  async function loadOrders(more = false) {
    await run(async () => {
      const result: Orders = await response(
        "/api/admin/quickbooks/costs?kind=orders" +
          (more && orders?.nextCursor
            ? "&cursor=" + encodeURIComponent(orders.nextCursor)
            : ""),
      );
      setOrders((old) =>
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
        setReturned("");
        setSource(null);
      }
    });
  }
  const selected = orders?.rows.find((r) => r.id === order);
  const choices = (type: string) =>
    accounts.filter(
      (a) => a.Active && a.CurrencyRef?.value === "USD" && a.AccountType === type,
    );
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Cost of goods and inventory returns</h2>
      <p>
        Review original FIFO costs and choose the company accounts for cost accounting.
        These actions do not post a journal entry.
      </p>
      <button className="ops-button" disabled={busy} onClick={() => loadAccounts()}>
        Load cost accounts
      </button>
      {data && (
        <>
          <p>Cost accounts for company {data.realm}</p>
          {data.mapping && (
            <p role="status">
              Saved cost mapping: {data.mapping.costAccount.name} ·{" "}
              {data.mapping.inventoryAccount.name}.
            </p>
          )}
          {data.canWrite && (
            <>
              <label className="block">
                Cost of goods sold account
                <select
                  aria-label="Cost of goods sold account"
                  className="mt-1 block w-full rounded border p-2"
                  disabled={busy}
                  value={cost}
                  onChange={(e) => {
                    setCost(e.target.value);
                    setConfirmed(false);
                    setRequestKey("");
                  }}
                >
                  <option value="">Choose a cost account</option>
                  {choices("Cost of Goods Sold").map((a) => (
                    <option key={a.Id} value={a.Id}>
                      {a.Name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Inventory asset account
                <select
                  aria-label="Inventory asset account"
                  className="mt-1 block w-full rounded border p-2"
                  disabled={busy}
                  value={inventory}
                  onChange={(e) => {
                    setInventory(e.target.value);
                    setConfirmed(false);
                    setRequestKey("");
                  }}
                >
                  <option value="">Choose an inventory account</option>
                  {choices("Other Current Asset").map((a) => (
                    <option key={a.Id} value={a.Id}>
                      {a.Name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed these cost and inventory accounts for this company.
              </label>
              <button
                className="ops-button"
                disabled={busy || !confirmed || !cost || !inventory}
                onClick={save}
              >
                Save cost mapping
              </button>
            </>
          )}
          {next && accounts.length < 1000 && (
            <button
              className="ops-button"
              disabled={busy}
              onClick={() => loadAccounts(true)}
            >
              Load more cost accounts
            </button>
          )}
          {next && accounts.length >= 1000 && (
            <p>
              The first 1,000 accounts are loaded. A larger chart needs a narrower
              accounting setup.
            </p>
          )}
        </>
      )}
      <hr />
      <button className="ops-button" disabled={busy} onClick={() => loadOrders()}>
        Load paid orders for cost review
      </button>
      {orders && (
        <>
          {!orders.rows.length && <p>No paid orders are available for cost review.</p>}
          <label className="block">
            Paid order
            <select
              aria-label="Paid order"
              className="mt-1 block w-full rounded border p-2"
              disabled={busy}
              value={order}
              onChange={(e) => {
                setOrder(e.target.value);
                setReturned("");
                setSource(null);
              }}
            >
              <option value="">Choose an order</option>
              {orders.rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <label className="block">
                Cost source
                <select
                  aria-label="Cost source"
                  className="mt-1 block w-full rounded border p-2"
                  disabled={busy}
                  value={returned}
                  onChange={(e) => {
                    setReturned(e.target.value);
                    setSource(null);
                  }}
                >
                  <option value="">Original sale</option>
                  {selected.returns.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      Return {i + 1} · {new Date(r.date).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
              {selected.moreReturns && (
                <p>
                  The latest 100 returns are shown. Older returns need individual
                  accounting review.
                </p>
              )}
              <button
                className="ops-button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setSource(null);
                    setSource(
                      await response(
                        "/api/admin/quickbooks/costs?kind=source&orderId=" +
                          encodeURIComponent(order) +
                          (returned ? "&returnId=" + encodeURIComponent(returned) : ""),
                      ),
                    );
                  })
                }
              >
                Review recorded cost
              </button>
            </>
          )}
          {orders.nextCursor && orders.rows.length < 500 && (
            <button
              className="ops-button"
              disabled={busy}
              onClick={() => loadOrders(true)}
            >
              Load more paid orders
            </button>
          )}
          {orders.nextCursor && orders.rows.length >= 500 && (
            <p>
              The first 500 orders are loaded. Older orders need individual accounting
              review.
            </p>
          )}
        </>
      )}
      {source && (
        <div role="status" className="space-y-2 rounded border p-4">
          <p>
            {source.number} ·{" "}
            {source.kind === "SALE"
              ? "Original sale cost"
              : "Sellable inventory restored"}
          </p>
          <p>
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: source.currency,
            }).format(source.amountCents / 100)}{" "}
            · {source.date}
          </p>
          <p>
            {source.pieces.reduce((n, p) => n + p.quantity, 0)} units supported by
            recorded FIFO allocations.
          </p>
          {source.kind === "RETURN" && (
            <p>Damaged goods do not restore the inventory asset balance.</p>
          )}
        </div>
      )}
      {source && data?.canWrite && (
        <PrepareCostJournal key={source.kind + ":" + source.sourceId} source={source} />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
