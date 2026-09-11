"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { QuickbooksMapping } from "./quickbooks-mapping";
import { QuickbooksExpenses } from "./quickbooks-expenses";
import type { quickbooksConnectionStatus } from "@/lib/services/quickbooks-connection";
type Status = Awaited<ReturnType<typeof quickbooksConnectionStatus>>;
export function QuickbooksConnection({
  status,
  callback,
}: {
  status: Status;
  callback?: string;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  async function act(action: "connect" | "refresh" | "disconnect") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/quickbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmed: true }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Connection could not be updated.");
      if (action === "connect") {
        const target = new URL(result.authorizationUrl);
        if (
          target.origin !== "https://appcenter.intuit.com" ||
          target.pathname !== "/connect/oauth2"
        )
          throw new Error("Connection address is unavailable.");
        window.location.assign(target.toString());
      } else {
        setConfirmed(false);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection could not be updated.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-semibold">QuickBooks connection</h1>
      <p>
        Connect the intended company for this environment. Accounting posting stays off
        until account mapping and posting acceptance are complete.
      </p>
      {callback === "failed" && (
        <p role="alert">
          QuickBooks connection was not confirmed. Check the selected company and start
          again.
        </p>
      )}
      {callback === "connected" && status.usable && (
        <p role="status">
          QuickBooks authorization was saved. Accounting posting is still off.
        </p>
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">Connection status</h2>
        <p>
          {status.usable
            ? "Authorization saved"
            : status.status === "DISCONNECTING"
              ? "Disconnect needs confirmation"
              : status.status === "NOT_CONNECTED" || status.status === "DISCONNECTED"
                ? "Not connected"
                : "Reconnect or refresh required"}
        </p>
        <p>Intended company: {status.realm ?? "Not configured"}</p>
        {status.companyName && <p>Authorized company: {status.companyName}</p>}
        {status.expiresAt && (
          <p>Access expires: {new Date(status.expiresAt).toLocaleString()}</p>
        )}
        {!status.configured && (
          <p>
            Save the app credentials and intended company ID in{" "}
            <a className="underline" href="/admin/integrations">
              Integrations
            </a>
            .
          </p>
        )}
        {status.canWrite && (
          <>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirm the intended company above and authorize this connection action.
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                className="ops-button"
                disabled={
                  busy ||
                  !confirmed ||
                  !status.configured ||
                  status.status === "DISCONNECTING"
                }
                onClick={() => act("connect")}
              >
                Connect to QuickBooks
              </button>
              <button
                className="ops-button"
                disabled={
                  busy ||
                  !confirmed ||
                  !status.configured ||
                  status.status !== "CONNECTED"
                }
                onClick={() => act("refresh")}
              >
                Refresh authorization
              </button>
              <button
                className="ops-button"
                disabled={
                  busy ||
                  !confirmed ||
                  !status.configured ||
                  ["NOT_CONNECTED", "DISCONNECTED"].includes(status.status)
                }
                onClick={() => act("disconnect")}
              >
                Disconnect QuickBooks
              </button>
            </div>
          </>
        )}
        {!status.canWrite && <p>Your accounting access is read-only.</p>}
      </section>
      {error && (
        <p role="alert" className="rounded-lg border p-4">
          {error}
        </p>
      )}
      <QuickbooksMapping />
      <QuickbooksExpenses />
    </div>
  );
}
