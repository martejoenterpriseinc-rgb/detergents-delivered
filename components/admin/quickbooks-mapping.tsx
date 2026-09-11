"use client";
import { useState } from "react";
import type { QuickbooksAccount } from "@/lib/integrations/quickbooks-client";
import type { quickbooksMappingData } from "@/lib/services/quickbooks-mapping";
type Data = Awaited<ReturnType<typeof quickbooksMappingData>>;
export function QuickbooksMapping() {
  const [data, setData] = useState<Data | null>(null),
    [accounts, setAccounts] = useState<QuickbooksAccount[]>([]),
    [next, setNext] = useState<number | null>(null),
    [category, setCategory] = useState(""),
    [expense, setExpense] = useState(""),
    [payment, setPayment] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestKey, setRequestKey] = useState("");
  const selected = data?.categories.find((c) => c.id === category);
  const available = (types: string[]) =>
    accounts.filter(
      (a) => a.Active && a.CurrencyRef?.value === "USD" && types.includes(a.AccountType),
    );
  async function response(url: string, init?: RequestInit) {
    const r = await fetch(url, init),
      v = await r.json();
    if (!r.ok) throw new Error(v.error ?? "Accounts could not be loaded.");
    return v;
  }
  async function load(more = false) {
    setBusy(true);
    setError("");
    try {
      const result = await response(
        "/api/admin/quickbooks/accounts?start=" + (more ? next : 1),
      );
      if (data && result.realm !== data.realm)
        throw new Error("The intended company changed. Reload this page.");
      const mapping = more
        ? data
        : await response("/api/admin/quickbooks/accounts?kind=mappings");
      if (mapping?.realm !== result.realm)
        throw new Error("The intended company changed. Reload this page.");
      setData(mapping);
      setAccounts((previous) =>
        more
          ? [
              ...previous,
              ...result.accounts.filter(
                (a: QuickbooksAccount) => !previous.some((p) => p.Id === a.Id),
              ),
            ]
          : result.accounts,
      );
      setNext(result.nextStart);
      if (!more) {
        setCategory("");
        setExpense("");
        setPayment("");
        setConfirmed(false);
        setRequestKey("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Accounts could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  function changed() {
    setConfirmed(false);
    setRequestKey("");
  }
  async function save() {
    if (!selected) return;
    setBusy(true);
    setError("");
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    try {
      const mapping = await response("/api/admin/quickbooks/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: key,
          categoryId: category,
          expenseAccountId: expense,
          paymentAccountId: payment,
          version: selected.mapping?.version ?? 0,
          confirmed: true,
        }),
      });
      setData((old) =>
        old
          ? {
              ...old,
              categories: old.categories.map((c) =>
                c.id === category ? { ...c, mapping } : c,
              ),
            }
          : old,
      );
      setConfirmed(false);
      setRequestKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mapping could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Expense account mapping</h2>
      <p>
        Match each expense category to an active USD expense account and its bank or
        credit-card account. Saving a mapping does not post an expense.
      </p>
      <button className="ops-button" disabled={busy} onClick={() => load()}>
        Load company accounts
      </button>
      {data && (
        <>
          <p>Accounts for company {data.realm}</p>
          {!data.categories.length && (
            <p>Record an expense category in Expenses before mapping it.</p>
          )}
          <label className="block">
            Expense category
            <select
              className="mt-1 block w-full rounded border p-2"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setExpense("");
                setPayment("");
                changed();
              }}
            >
              <option value="">Choose a category</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {selected?.mapping && (
            <p role="status">
              Saved mapping: {selected.mapping.expenseAccount.name} · Paid from{" "}
              {selected.mapping.paymentAccount.name}. Verified{" "}
              {new Date(selected.mapping.verifiedAt).toISOString().slice(0, 10)}.
            </p>
          )}
          {data.canWrite && selected && (
            <>
              <label className="block">
                QuickBooks expense account
                <select
                  className="mt-1 block w-full rounded border p-2"
                  value={expense}
                  onChange={(e) => {
                    setExpense(e.target.value);
                    changed();
                  }}
                >
                  <option value="">Choose an expense account</option>
                  {available(["Expense", "Other Expense"]).map((a) => (
                    <option key={a.Id} value={a.Id}>
                      {a.Name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Paid from account
                <select
                  className="mt-1 block w-full rounded border p-2"
                  value={payment}
                  onChange={(e) => {
                    setPayment(e.target.value);
                    changed();
                  }}
                >
                  <option value="">Choose a bank or credit-card account</option>
                  {available(["Bank", "Credit Card"]).map((a) => (
                    <option key={a.Id} value={a.Id}>
                      {a.Name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed these accounts for this category and company.
              </label>
              <button
                className="ops-button"
                disabled={busy || !confirmed || !expense || !payment}
                onClick={save}
              >
                Save account mapping
              </button>
            </>
          )}
          {next && accounts.length < 1000 && (
            <button className="ops-button" disabled={busy} onClick={() => load(true)}>
              Load more accounts
            </button>
          )}
          {next && accounts.length >= 1000 && (
            <p>
              The first 1,000 accounts are loaded. A larger chart needs a narrower
              accounting setup before mapping.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="rounded border p-3">
          {error}
        </p>
      )}
    </section>
  );
}
