"use client";
import { useState } from "react";
import type { salesMappingSources } from "@/lib/services/quickbooks-sales-mapping";
import type { QuickbooksSalesEntity } from "@/lib/integrations/quickbooks-client";
type Data = Awaited<ReturnType<typeof salesMappingSources>>;
export function QuickbooksSalesMapping() {
  const [kind, setKind] = useState<"customer" | "item">("customer"),
    [data, setData] = useState<Data | null>(null),
    [entities, setEntities] = useState<QuickbooksSalesEntity[]>([]),
    [next, setNext] = useState<number | null>(null),
    [source, setSource] = useState(""),
    [external, setExternal] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [requestKey, setRequestKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selected = data?.rows.find((r) => r.id === source);
  async function response(url: string, init?: RequestInit) {
    const r = await fetch(url, init),
      v = await r.json();
    if (!r.ok) throw new Error(v.error ?? "Sales links could not be loaded.");
    return v;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sales links could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setSource("");
    setExternal("");
    setConfirmed(false);
    setRequestKey("");
  }
  async function load() {
    await run(async () => {
      const rows: Data = await response(
          "/api/admin/quickbooks/sales-mappings?kind=" + kind,
        ),
        remote = await response(
          "/api/admin/quickbooks/sales-mappings?view=provider&kind=" + kind + "&start=1",
        );
      if (rows.realm !== remote.realm)
        throw new Error("The company changed. Reload before choosing links.");
      setData(rows);
      setEntities(remote.rows);
      setNext(remote.nextStart);
      reset();
    });
  }
  async function more(provider: boolean) {
    await run(async () => {
      if (!data) return;
      const result = await response(
        "/api/admin/quickbooks/sales-mappings?kind=" +
          kind +
          (provider
            ? "&view=provider&start=" + next
            : "&cursor=" + encodeURIComponent(data.nextCursor ?? "")),
      );
      if (result.realm !== data.realm)
        throw new Error("The company changed. Reload before saving.");
      if (provider) {
        setEntities((old) => [
          ...old,
          ...result.rows.filter(
            (r: QuickbooksSalesEntity) => !old.some((p) => p.id === r.id),
          ),
        ]);
        setNext(result.nextStart);
      } else
        setData({
          ...result,
          rows: [
            ...data.rows,
            ...result.rows.filter(
              (r: Data["rows"][number]) => !data.rows.some((p) => p.id === r.id),
            ),
          ],
        });
    });
  }
  async function save() {
    if (!selected || !data || !confirmed) return;
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    await run(async () => {
      const mapping = await response("/api/admin/quickbooks/sales-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: key,
          kind,
          sourceId: source,
          externalId: external,
          version: selected.mapping?.version ?? 0,
          confirmed: true,
        }),
      });
      setData({
        ...data,
        rows: data.rows.map((r) => (r.id === source ? { ...r, mapping } : r)),
      });
      setConfirmed(false);
      setRequestKey("");
    });
  }
  const available = entities.filter(
    (r) =>
      r.active &&
      (r.kind === "customer"
        ? r.currency === "USD"
        : ["NonInventory", "Service"].includes(r.type) &&
          !r.tracksQuantity &&
          r.incomeAccountId),
  );
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Customer and product links</h2>
      <p>
        Link application records to existing records in the intended QuickBooks company.
        Product links use non-inventory sales items so this application retains inventory
        and FIFO cost control. Saving a link does not create a sale or refund.
      </p>
      <label className="block">
        Link type
        <select
          aria-label="Link type"
          className="mt-1 block w-full rounded border p-2"
          value={kind}
          disabled={busy}
          onChange={(e) => {
            setKind(e.target.value as "customer" | "item");
            setData(null);
            setEntities([]);
            setNext(null);
            setError("");
            reset();
          }}
        >
          <option value="customer">Household customer</option>
          <option value="item">Product variant</option>
        </select>
      </label>
      <button className="ops-button" disabled={busy} onClick={load}>
        Load sales links
      </button>
      {data && (
        <>
          <p>Links for company {data.realm}</p>
          {!data.rows.length && <p>No application records are available.</p>}
          <label className="block">
            Application record
            <select
              aria-label="Application record"
              className="mt-1 block w-full rounded border p-2"
              disabled={busy}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setExternal("");
                setConfirmed(false);
                setRequestKey("");
              }}
            >
              <option value="">Choose a record</option>
              {data.rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          {selected?.mapping && (
            <p role="status">Saved link: {selected.mapping.externalName}.</p>
          )}
          {selected && data.canWrite && (
            <>
              <label className="block">
                QuickBooks record
                <select
                  aria-label="QuickBooks record"
                  className="mt-1 block w-full rounded border p-2"
                  disabled={busy}
                  value={external}
                  onChange={(e) => {
                    setExternal(e.target.value);
                    setConfirmed(false);
                    setRequestKey("");
                  }}
                >
                  <option value="">Choose the matching company record</option>
                  {available.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
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
                I checked that these records represent the same customer or product in
                this company.
              </label>
              <button
                className="ops-button"
                disabled={busy || !external || !confirmed}
                onClick={save}
              >
                Save sales link
              </button>
            </>
          )}
          {data.nextCursor && data.rows.length < 500 && (
            <button className="ops-button" disabled={busy} onClick={() => more(false)}>
              Load more application records
            </button>
          )}
          {next && entities.length < 1000 && (
            <button className="ops-button" disabled={busy} onClick={() => more(true)}>
              Load more QuickBooks records
            </button>
          )}
          {((data.nextCursor && data.rows.length >= 500) ||
            (next && entities.length >= 1000)) && (
            <p>
              The review limit is reached. Remaining records need a narrower accounting
              selection.
            </p>
          )}
          {!data.canWrite && <p>Your accounting access is read-only.</p>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
