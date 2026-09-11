"use client";
import { useState } from "react";
import type { QuickbooksAccount } from "@/lib/integrations/quickbooks-client";
import type { receiptSettingsData } from "@/lib/services/quickbooks-receipt-settings";
type Data = Awaited<ReturnType<typeof receiptSettingsData>>;
export function QuickbooksReceiptSettings() {
  const [data, setData] = useState<Data | null>(null),
    [accounts, setAccounts] = useState<QuickbooksAccount[]>([]),
    [next, setNext] = useState<number | null>(null),
    [selected, setSelected] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function response(url: string, init?: RequestInit) {
    const r = await fetch(url, init),
      v = await r.json();
    if (!r.ok) throw new Error(v.error ?? "Receipt settings could not be updated.");
    return v;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receipt settings failed.");
    } finally {
      setBusy(false);
    }
  }
  async function load(more = false) {
    await run(async () => {
      const mapping: Data =
        more && data ? data : await response("/api/admin/quickbooks/receipt-settings");
      const result = await response(
        "/api/admin/quickbooks/accounts?start=" + (more ? next : 1),
      );
      if (result.realm !== mapping.realm)
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
        setSelected("");
        setConfirmed(false);
        setKey("");
      }
    });
  }
  async function save() {
    if (!data || !confirmed) return;
    const requestKey = key || crypto.randomUUID();
    setKey(requestKey);
    await run(async () => {
      const mapping = await response("/api/admin/quickbooks/receipt-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey,
          depositAccountId: selected,
          version: data.mapping?.version ?? 0,
          confirmed: true,
        }),
      });
      setData({ ...data, mapping });
      setConfirmed(false);
      setKey("");
    });
  }
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Receipt clearing account</h2>
      <p>
        Choose the company account used to track receipt cash before payout
        reconciliation. Saving checks the company&apos;s country, home currency and sales-tax
        setting.
      </p>
      <button className="ops-button" disabled={busy} onClick={() => load()}>
        Load receipt accounts
      </button>
      {data && (
        <>
          <p>Receipt settings for company {data.realm}</p>
          {data.mapping && (
            <div className="space-y-2 rounded border p-4" role="status">
              <p>Saved receipt clearing account: {data.mapping.depositAccount.name}.</p>
              <p>Last checked: US company, USD home currency, sales tax enabled.</p>
              <p>Checked {new Date(data.mapping.verifiedAt).toLocaleString()}.</p>
            </div>
          )}
          {data.canWrite && (
            <>
              <label className="block">
                Receipt clearing account
                <select
                  aria-label="Receipt clearing account"
                  className="mt-1 block w-full rounded border p-2"
                  value={selected}
                  disabled={busy}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setConfirmed(false);
                    setKey("");
                  }}
                >
                  <option value="">Choose a clearing account</option>
                  {accounts
                    .filter(
                      (a) =>
                        a.Active &&
                        a.AccountType === "Bank" &&
                        a.CurrencyRef?.value === "USD",
                    )
                    .map((a) => (
                      <option value={a.Id} key={a.Id}>
                        {a.Name}
                      </option>
                    ))}
                </select>
              </label>
              {next && accounts.length < 1000 && (
                <button className="ops-button" disabled={busy} onClick={() => load(true)}>
                  More receipt accounts
                </button>
              )}
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed this company&apos;s clearing account for payment receipts.
              </label>
              <button
                className="ops-button"
                disabled={busy || !confirmed || !selected}
                onClick={save}
              >
                Save receipt settings
              </button>
            </>
          )}
        </>
      )}
      <p>
        Saving these settings does not post a receipt or confirm provider tax acceptance.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
