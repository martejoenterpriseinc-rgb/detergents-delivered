"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  Check,
  ChevronRight,
  MapPin,
  Navigation,
  Play,
  RefreshCw,
  Search,
  Truck,
} from "lucide-react";
import { AreaMap } from "./area-map";
import { DatePicker, Empty, Kpi, OperationsHeading, StatusPill } from "./operations-ui";
import { money, wazeUrl, type QueueData, type StopRow } from "@/lib/domain/operations";

export function DeliveryQueue({
  initial,
  initialStatus = "all",
}: {
  initial: QueueData;
  initialStatus?: string;
}) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const [photoStop, setPhotoStop] = useState<StopRow | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const photoKey = useRef("");
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/operations/queue?date=${data.date}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw Error();
      setData(await r.json());
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [data.date]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    const f = () => void refresh();
    window.addEventListener("focus", f);
    window.addEventListener("online", f);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", f);
      window.removeEventListener("online", f);
    };
  }, [refresh]);
  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photoUrl],
  );
  const pending = data.stops.find((s) => s.status !== "COMPLETED");
  const filtered = data.stops.filter(
    (s) =>
      (status !== "completed" || s.status === "COMPLETED") &&
      (status !== "pending" || s.status !== "COMPLETED") &&
      [s.customer, s.address, s.orderNumber]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  async function action(stop: StopRow, kind: "begin" | "navigate" | "arrive") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin/operations/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: kind,
          routeId: stop.routeId,
          ...(kind !== "begin" ? { stopId: stop.id } : {}),
          requestKey: crypto.randomUUID(),
        }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error ?? "Action could not be saved.");
      await refresh();
      setNotice(
        kind === "begin"
          ? "Deliveries started. Continue with the first stop."
          : kind === "navigate"
            ? "Driver en route saved. Open Waze to navigate."
            : "Arrival saved. Take a delivery photo to finish this stop.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Save failed. Refresh before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function complete() {
    if (!photoStop || !photo) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("photo", photo);
      form.set("routeId", photoStop.routeId);
      form.set("stopId", photoStop.id);
      form.set("requestKey", photoKey.current);
      const r = await fetch("/api/admin/operations/proof", {
        method: "POST",
        body: form,
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error ?? "Photo could not be saved.");
      setPhotoStop(null);
      setPhoto(null);
      await refresh();
      setNotice("Delivery completed. The photo is available in the customer's account.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Upload failed. Delivery is not completed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const start = () =>
    pending && action(pending, pending.status === "SCHEDULED" ? "begin" : "navigate");
  return (
    <div className="ops-page">
      <OperationsHeading
        eyebrow="DELIVERY OPERATIONS"
        title="Daily delivery dashboard"
        subtitle="Your stops, in order. One clear next step at a time."
        date={data.date}
        start={false}
        invite={data.canManage}
      />
      {data.canManage && (
        <div className="flex flex-wrap gap-3">
          <Link className="ops-button secondary" href="/admin/settings/launch">
            Delivery settings · Launch & capacity
          </Link>
          <Link className="ops-button secondary" href="/admin/deliveries/launch">
            Review launch demand
          </Link>
        </div>
      )}
      <nav aria-label="Route mileage" className="flex flex-wrap gap-3">
        {data.routeIds.map((id) => (
          <Link
            key={id}
            className="ops-button secondary"
            href={{
              pathname: data.canManage
                ? `/admin/deliveries/${id}/mileage`
                : `/driver/mileage/${id}`,
            }}
          >
            Mileage · {data.stops.find((s) => s.routeId === id)?.routeNumber ?? "Route"}
          </Link>
        ))}
      </nav>
      <div className="ops-toolbar">
        <DatePicker
          date={data.date}
          path={data.canManage ? "/admin/deliveries" : "/driver"}
        />
        <span className={`ops-live ${stale ? "is-stale" : ""}`}>
          <i />
          {stale ? "Updates unavailable" : "Updates every 15 seconds"}
        </span>
        <button className="ops-button secondary" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <AreaMap
        numbered
        pins={data.stops.map((s, i) => ({
          id: s.id,
          name: s.customer,
          lat: s.lat,
          lng: s.lng,
          number: i + 1,
          color:
            s.status === "COMPLETED"
              ? "#8b9c99"
              : s.status === "EN_ROUTE" || s.status === "ARRIVED"
                ? "#e5a226"
                : "#087b74",
        }))}
        label="Today's delivery map"
      />
      <div className="ops-map-legend">
        <span>
          <i className="teal" />
          Scheduled stop
        </span>
        <span>
          <i className="amber" />
          Current stop
        </span>
        <span>
          <i className="gray" />
          Completed
        </span>
        <p>Pins follow saved stop order. Lines and driving ETAs are not inferred.</p>
      </div>
      <div className="ops-kpi-grid three">
        <Kpi
          label="Today's deliveries"
          value={data.total}
          detail="All scheduled stops"
          href={`${data.canManage ? "/admin/deliveries" : "/driver"}?date=${data.date}`}
          icon={<Truck size={20} />}
        />
        <Kpi
          label="Completed deliveries"
          value={data.completed}
          detail={`${data.total - data.completed} stops remaining`}
          href={`${data.canManage ? "/admin/deliveries" : "/driver"}?date=${data.date}&status=completed`}
          icon={<Check size={20} />}
        />
        {data.canManage && (
          <Kpi
            label="Daily delivery revenue"
            value={money(data.revenueCents)}
            detail="Paid order totals · includes tax"
            href={`${data.canManage ? "/admin/deliveries" : "/driver"}?date=${data.date}&report=revenue`}
            icon={<span>$</span>}
          />
        )}
      </div>
      <section className="ops-panel">
        <div className="ops-route-banner">
          <div>
            <span className="ops-eyebrow">TODAY’S DELIVERY QUEUE</span>
            <h2>
              {data.completed} of {data.total} stops completed
            </h2>
            <p>
              Planned miles: {data.plannedMiles ?? "Not measured"} <span>·</span> Actual
              miles: {data.actualMiles ?? "Not recorded"}
            </p>
          </div>
          <button
            className="ops-button"
            disabled={
              busy ||
              !pending ||
              !data.proofReady ||
              !["SCHEDULED", "TODAY"].includes(pending.status)
            }
            onClick={() => void start()}
          >
            <Play size={16} fill="currentColor" />
            {data.stops.some((s) => !["SCHEDULED", "COMPLETED"].includes(s.status))
              ? "Continue deliveries"
              : "Start deliveries"}
          </button>
        </div>
        <div className="ops-progress">
          <div
            style={{ width: `${data.total ? (data.completed / data.total) * 100 : 0}%` }}
          />
        </div>
        {!data.proofReady && (
          <p className="ops-callout">
            Private proof-photo storage must be connected before route execution. Stops
            and order history remain available.
          </p>
        )}
        {notice && (
          <p className="ops-success" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="ops-error" role="alert">
            {error}
          </p>
        )}
        <div className="ops-toolbar queue-filters">
          <label className="ops-search">
            <Search size={16} />
            <input
              aria-label="Find a delivery"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customer, address or order"
            />
          </label>
          <select
            aria-label="Delivery status filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All deliveries</option>
            <option value="pending">Remaining deliveries</option>
            <option value="completed">Completed deliveries</option>
          </select>
          <button
            className="ops-button secondary"
            onClick={() => {
              const csv = [
                ["Stop", "Customer", "Order", "Status", "Revenue cents"],
                ...filtered.map((s) => [
                  String(data.stops.indexOf(s) + 1),
                  s.customer,
                  s.orderNumber,
                  s.status,
                  String(s.revenueCents),
                ]),
              ]
                .map((row) =>
                  row
                    .map(
                      (v) =>
                        '"' +
                        (/^[=+\-@\t\r]/.test(v) ? "'" : "") +
                        v.replaceAll('"', '""') +
                        '"',
                    )
                    .join(","),
                )
                .join("\r\n");
              const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `deliveries-${data.date}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export
          </button>
        </div>
        <div className="ops-stop-list">
          {filtered.map((s) => {
            const active = s.id === pending?.id;
            const navigation = wazeUrl(s.lat, s.lng);
            return (
              <article
                className={`ops-stop ${active ? "active-stop" : ""}`}
                key={s.id}
                data-testid={`stop-${s.id}`}
              >
                <div
                  className={`ops-stop-number ${s.status === "COMPLETED" ? "done" : ""}`}
                >
                  {s.status === "COMPLETED" ? (
                    <Check size={19} />
                  ) : (
                    data.stops.indexOf(s) + 1
                  )}
                </div>
                <div className="ops-stop-info">
                  <div className="ops-stop-title">
                    <h3>{s.customer}</h3>
                    <StatusPill status={s.status} />
                  </div>
                  <p>
                    <MapPin size={13} />
                    {s.address}
                  </p>
                  <p className="ops-stop-order">
                    {s.orderNumber} · {s.items || "No items recorded"}
                  </p>
                  <span className="ops-stop-eta">
                    {s.eta
                      ? `Planned arrival: ${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(new Date(s.eta))}`
                      : "Arrival estimate not available"}{" "}
                    · Source: saved route schedule
                  </span>
                </div>
                <div className="ops-stop-controls">
                  {data.canManage && <strong>{money(s.revenueCents)}</strong>}
                  {s.status === "COMPLETED" ? (
                    s.photoId ? (
                      <a
                        href={`/api/account/proof/${s.photoId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ops-button secondary"
                      >
                        <Camera size={15} />
                        View photo
                      </a>
                    ) : (
                      <span className="ops-muted">No saved photo</span>
                    )
                  ) : (
                    <>
                      <button
                        disabled={
                          busy ||
                          !active ||
                          !data.proofReady ||
                          !["SCHEDULED", "TODAY"].includes(s.status)
                        }
                        className="ops-button secondary"
                        onClick={() =>
                          void action(s, s.status === "SCHEDULED" ? "begin" : "navigate")
                        }
                      >
                        <Navigation size={15} />
                        Start delivery
                      </button>
                      {active && s.status === "EN_ROUTE" && (
                        <>
                          <a
                            href={navigation ?? undefined}
                            aria-disabled={!navigation}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ops-button"
                          >
                            Open Waze <ChevronRight size={14} />
                          </a>
                          <button
                            className="ops-button secondary"
                            disabled={busy}
                            onClick={() => void action(s, "arrive")}
                          >
                            I’ve arrived
                          </button>
                        </>
                      )}
                      <button
                        className="ops-button secondary"
                        disabled={busy || !active || s.status !== "ARRIVED"}
                        onClick={() => {
                          setPhoto(null);
                          setPhotoUrl("");
                          photoKey.current = crypto.randomUUID();
                          setPhotoStop(s);
                        }}
                      >
                        <Camera size={15} />
                        Take picture
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {!filtered.length && <Empty>No deliveries match this view.</Empty>}
      </section>
      {photoStop && (
        <div
          className="ops-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="photo-heading"
        >
          <div className="ops-modal-card">
            <h2 id="photo-heading">Complete delivery to {photoStop.customer}</h2>
            <p>The photo is private to this customer and authorized staff.</p>
            <input
              aria-label="Delivery proof photo"
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setPhoto(file);
                setPhotoUrl(file ? URL.createObjectURL(file) : "");
                photoKey.current = crypto.randomUUID();
              }}
            />
            {photoUrl && (
              <img
                className="ops-photo-preview"
                src={photoUrl}
                alt="Delivery proof preview"
              />
            )}
            {error && (
              <p role="alert" className="ops-error">
                {error}
              </p>
            )}
            <div className="ops-heading-actions">
              <button
                className="ops-button secondary"
                disabled={busy}
                onClick={() => setPhotoStop(null)}
              >
                Cancel
              </button>
              <button
                className="ops-button"
                disabled={busy || !photo}
                onClick={() => void complete()}
              >
                {busy ? "Saving photo…" : "Save photo & complete delivery"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
