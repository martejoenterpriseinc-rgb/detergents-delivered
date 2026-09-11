"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { listCommerceGrants } from "@/lib/services/commerce-grants";
const labels = {
  "orders.read": "Read my orders and delivery status",
  "subscriptions.read": "Read my subscription schedules",
  "rewards.read": "Read my rewards balance",
  "quotes.create": "Read approved addresses and prepare order quotes",
};
type Scope = keyof typeof labels;
export function Connections({
  grants,
  canCreate,
}: {
  grants: Awaited<ReturnType<typeof listCommerceGrants>>;
  canCreate: boolean;
}) {
  const router = useRouter(),
    [label, setLabel] = useState(""),
    [days, setDays] = useState(1),
    [scopes, setScopes] = useState<Scope[]>(["orders.read"]);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [token, setToken] = useState<string | null>(null),
    [requestKey, setKey] = useState<string | null>(null);
  async function send(body: unknown) {
    const response = await fetch("/api/account/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Connection update failed.");
    return result;
  }
  return (
    <div className="space-y-6">
      <p>
        Give an application only the access it needs. Connections expire within seven days
        and can be revoked at any time. Applications cannot charge you or change your
        subscriptions. You review and pay for prepared quotes yourself.
      </p>
      {canCreate ? (
        <form
          className="space-y-4 rounded-2xl border p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            setToken(null);
            const key = requestKey ?? crypto.randomUUID();
            setKey(key);
            try {
              const result = await send({
                action: "issue",
                requestKey: key,
                label,
                days,
                scopes,
                consentVersion: "commerce-delegation-v1",
                confirmed: true,
              });
              setToken(result.token);
              setKey(null);
              setConsent(false);
              setMessage(
                result.token
                  ? "Connection created. Copy the access key now; it cannot be shown again."
                  : "This connection was already created. If the key was lost, revoke it and create another.",
              );
              router.refresh();
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Creation could not be confirmed. Retry this request.",
              );
              router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="text-xl font-semibold">Connect an application</h2>
          <label className="grid gap-1">
            Application name
            <input
              className="rounded border p-2"
              value={label}
              required
              minLength={2}
              maxLength={80}
              disabled={busy}
              onChange={(e) => {
                setLabel(e.target.value);
                setKey(null);
              }}
            />
          </label>
          <fieldset disabled={busy} className="space-y-2">
            <legend className="mb-2 font-semibold">Allowed access</legend>
            {Object.entries(labels).map(([scope, text]) => (
              <label key={scope} className="flex gap-2">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope as Scope)}
                  onChange={(e) => {
                    setScopes(
                      e.target.checked
                        ? [...scopes, scope as Scope]
                        : scopes.filter((s) => s !== scope),
                    );
                    setKey(null);
                  }}
                />
                {text}
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1">
            Expires after
            <select
              className="rounded border p-2"
              value={days}
              disabled={busy}
              onChange={(e) => {
                setDays(Number(e.target.value));
                setKey(null);
              }}
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
            </select>
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I authorize this application to use the selected access until expiry or
            revocation.
          </label>
          <button
            className="rounded-xl bg-teal-800 px-4 py-3 font-semibold text-white disabled:opacity-50"
            disabled={busy || !consent || !scopes.length}
          >
            Create access key
          </button>
        </form>
      ) : (
        <p>
          Verify your email before creating a new connection. You can still revoke
          existing connections.
        </p>
      )}
      {token && (
        <section className="space-y-2 rounded-xl border p-4">
          <label className="grid gap-2">
            One-time access key
            <textarea
              readOnly
              className="w-full rounded border p-2 font-mono text-sm break-all"
              rows={4}
              value={token}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p className="text-sm">
            Keep this key private and provide it only to the application you authorized.
          </p>
          <button className="underline" onClick={() => setToken(null)}>
            Hide access key
          </button>
        </section>
      )}
      {message && (
        <p role="alert" className="rounded border p-3">
          {message}
        </p>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your connections</h2>
        {!grants.length && <p>No connections yet.</p>}
        {grants.map((grant) => (
          <article key={grant.id} className="space-y-2 rounded-xl border p-4">
            <h3 className="font-semibold break-words">{grant.label}</h3>
            <p>
              {grant.active ? "Active" : "Access ended"} · Expires{" "}
              {new Date(grant.expiresAt).toLocaleDateString("en-US")}
            </p>
            <ul className="list-inside list-disc text-sm">
              {grant.scopes.map((scope) => (
                <li key={scope}>{labels[scope as Scope] ?? scope}</li>
              ))}
            </ul>
            {!grant.revokedAt && (
              <button
                className="underline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setMessage("");
                  try {
                    await send({ action: "revoke", id: grant.id });
                    setToken(null);
                    setMessage("Connection revoked.");
                    router.refresh();
                  } catch (error) {
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "Revocation could not be confirmed. Retry.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Revoke connection
              </button>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
