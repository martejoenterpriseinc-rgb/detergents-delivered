"use client";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import type { RouteMileageData } from "@/lib/services/route-mileage";
export function RouteMileage({ initial }: { initial: RouteMileageData }) {
  const pathname = usePathname();
  const [data, setData] = useState(initial);
  const [legs, setLegs] = useState(
    initial.legs.map((l) => ({
      sequence: l.sequence,
      start: l.start ?? "",
      end: l.end ?? "",
      planned: l.planned ?? "",
    })),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ body: string; key: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const payload = {
      routeId: data.id,
      version: data.version,
      reason,
      legs: legs.map((l) => ({
        ...l,
        start: l.start || null,
        end: l.end || null,
        planned: l.planned || null,
      })),
    };
    const body = JSON.stringify(payload);
    if (pending.current && pending.current.body !== body) {
      setError(
        "An earlier save is unconfirmed. Reload saved mileage before submitting changed readings.",
      );
      setBusy(false);
      return;
    }
    pending.current ??= { body, key: crypto.randomUUID() };
    try {
      const response = await fetch("/api/admin/operations/mileage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestKey: pending.current.key }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) pending.current = null;
        throw Error(result.error ?? "Mileage save could not be confirmed.");
      }
      setData((old) => ({ ...old, version: result.version }));
      pending.current = null;
      setNotice("Mileage saved. Reload to view updated route totals.");
      setReason("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Save could not be confirmed. Retry the same readings.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-semibold">Route mileage</h1>
        <p className="mt-2 break-words">
          {data.number} · {data.date} · {data.vehicle}
        </p>
      </header>
      <p>
        Planned: {data.planned ?? "Not fully estimated"}
        {data.planned !== null ? " miles" : ""} · Actual:{" "}
        {data.actual ?? "Not fully recorded"}
        {data.actual !== null ? " miles" : ""}
      </p>
      <p>
        Record your odometer at each stop and on return to the starting location. Use
        miles with up to two decimals. Leave untravelled legs blank. Opening navigation
        does not measure distance.
      </p>
      <a className="ops-button secondary" href={pathname}>
        Reload saved mileage
      </a>
      {error && (
        <p
          role="alert"
          aria-label="Mileage save error"
          className="rounded border border-red-400 p-3"
        >
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={save} className="space-y-4">
        {legs.map((l, i) => (
          <fieldset
            key={l.sequence}
            disabled={busy || !data.canWrite}
            className="rounded-xl border bg-white p-4"
          >
            <legend className="px-2 font-semibold">{data.legs[i].label}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["start", "end", "planned"] as const).map((key) => (
                <label key={key} className="grid min-w-0 gap-1">
                  {key === "start"
                    ? "Starting odometer"
                    : key === "end"
                      ? "Ending odometer"
                      : "Planned miles (optional)"}
                  <input
                    aria-label={`${data.legs[i].label}: ${key}`}
                    className="min-w-0 rounded border p-2"
                    type="text"
                    inputMode="decimal"
                    value={l[key]}
                    onChange={(e) =>
                      setLegs((old) =>
                        old.map((x, n) =>
                          n === i ? { ...x, [key]: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {data.canWrite && (
          <>
            <label className="grid gap-1">
              Reason for update{data.version > 0 ? " (required)" : " (optional)"}
              <textarea
                className="rounded border p-2"
                maxLength={500}
                required={data.version > 0}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </label>
            <button className="ops-button" disabled={busy}>
              {busy ? "Saving…" : "Save mileage"}
            </button>
          </>
        )}
      </form>
      <p className="text-sm">
        Saved readings feed mileage reports once each. Corrections preserve the prior
        readings in the audit history. A route total remains unknown until every leg,
        including the return trip, is recorded.
      </p>
    </div>
  );
}
