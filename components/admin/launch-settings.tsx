"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-fetch";
import { cadenceDates, type LaunchConfig } from "@/lib/domain/launch";
import { Input } from "@/components/ui/input";
import { Field } from "./field";
import type { getLaunchWorkspace } from "@/lib/services/launch";
type Workspace = Awaited<ReturnType<typeof getLaunchWorkspace>>;
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function LaunchSettings({ initial }: { initial: Workspace }) {
  const router = useRouter();
  const [config, setConfig] = useState(initial.config);
  const [savedConfig, setSavedConfig] = useState(initial.config);
  const [month, setMonth] = useState(initial.config.launchDate.slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function save(path: string, data: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await adminFetch(path, {
        method: "POST",
        body: JSON.stringify(data),
      });
      setNotice("Settings saved. Existing bookings have not moved.");
      router.refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }
  const cursor = new Date(`${month}-01T00:00:00Z`);
  const monthValid = !Number.isNaN(cursor.getTime());
  if (monthValid) cursor.setUTCDate(1 - ((cursor.getUTCDay() + 6) % 7));
  const cells = monthValid
    ? Array.from({ length: 42 }, (_, i) => {
        const d = new Date(cursor);
        d.setUTCDate(d.getUTCDate() + i);
        return d.toISOString().slice(0, 10);
      })
    : [];
  function changeCadence(
    zoneId: string,
    patch: Partial<LaunchConfig["cadences"][number]>,
  ) {
    const prior = config.cadences.find((c) => c.zoneId === zoneId);
    const next = {
      zoneId,
      vehicleId: initial.vehicles[0]?.id ?? "",
      weeks: [1],
      weekday: 4,
      locked: false,
      ...prior,
      ...patch,
    };
    setConfig({
      ...config,
      cadences: [...config.cadences.filter((c) => c.zoneId !== zoneId), next],
    });
  }
  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-900">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-teal-50 p-4">
          {notice}
        </p>
      )}
      <form
        className="space-y-5 rounded-3xl border border-teal-100 bg-white p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await save("/api/admin/launch", config);
          if (result) {
            setConfig(result as LaunchConfig);
            setSavedConfig(result as LaunchConfig);
          }
        }}
      >
        <h2 className="text-xl font-semibold">Launch & first delivery window</h2>
        <fieldset disabled={busy} className="space-y-4">
          <label>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />{" "}
            Show planned launch window
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["launchDate", "Launch date"],
                ["cutoffDate", "Include orders through"],
                ["firstDeliveryBy", "First delivery by"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input
                  type="date"
                  value={config[key]}
                  required
                  onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <p className="text-sm" data-testid="saved-launch-date">
            Saved launch date: {savedConfig.version ? savedConfig.launchDate : "Not set"}
            {JSON.stringify(config) !== JSON.stringify(savedConfig) &&
              " · Unsaved launch changes"}
          </p>
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
            Ordering is not enabled by this setting. Until checkout is connected, no
            launch payments or delivery reservations are accepted. When ordering opens,
            payment is collected at purchase and the delivery window must be accepted at
            checkout.
          </p>
          <h2 className="text-xl font-semibold">Recurring area cadence</h2>
          <p className="text-sm">
            Assign each area to calendar weeks and a delivery day. Week 1 is the first
            Monday–Sunday row, including partial weeks. A month may have six rows. Lock an
            approved cadence; unlock and save separately before changing it. Existing paid
            bookings remain fixed.
          </p>
          {!initial.zones.length && (
            <p>Create a delivery area below to assign its weeks.</p>
          )}
          {initial.zones.map((zone) => {
            const c = config.cadences.find((v) => v.zoneId === zone.id);
            return (
              <div
                key={zone.id}
                className="space-y-3 rounded-xl border border-teal-100 p-4"
              >
                <h3 className="font-semibold">{zone.name}</h3>
                <div className="flex flex-wrap gap-3">
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(c)}
                      onChange={(e) =>
                        e.target.checked
                          ? changeCadence(zone.id, {})
                          : setConfig({
                              ...config,
                              cadences: config.cadences.filter(
                                (v) => v.zoneId !== zone.id,
                              ),
                            })
                      }
                    />{" "}
                    Assign cadence
                  </label>
                  {c && (
                    <>
                      <label>
                        Vehicle{" "}
                        <select
                          aria-label={`${zone.name} vehicle`}
                          value={c.vehicleId}
                          onChange={(e) =>
                            changeCadence(zone.id, { vehicleId: e.target.value })
                          }
                        >
                          {!c.vehicleId && <option value="">Select vehicle</option>}
                          {initial.vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Day{" "}
                        <select
                          aria-label={`${zone.name} day`}
                          value={c.weekday}
                          onChange={(e) =>
                            changeCadence(zone.id, { weekday: Number(e.target.value) })
                          }
                        >
                          {days.map((d, i) => (
                            <option key={d} value={i}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </label>
                      {[1, 2, 3, 4, 5, 6].map((week) => (
                        <label key={week}>
                          <input
                            type="checkbox"
                            checked={c.weeks.includes(week)}
                            onChange={(e) =>
                              changeCadence(zone.id, {
                                weeks: e.target.checked
                                  ? [...c.weeks, week].sort()
                                  : c.weeks.filter((v) => v !== week),
                              })
                            }
                          />{" "}
                          Week {week}
                        </label>
                      ))}
                      <label>
                        <input
                          type="checkbox"
                          checked={c.locked}
                          onChange={(e) =>
                            changeCadence(zone.id, { locked: e.target.checked })
                          }
                        />{" "}
                        Lock cadence
                      </label>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </fieldset>
        <button className="ops-button" disabled={busy}>
          Save launch & cadence
        </button>
      </form>
      <section className="space-y-4 rounded-3xl border border-teal-100 bg-white p-6">
        <h2 className="text-xl font-semibold">Monthly calendar — cadence preview</h2>
        <label>
          Month{" "}
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <div className="overflow-x-auto">
          <div className="grid min-w-[650px] grid-cols-7">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <strong className="p-2" key={day}>
                {day}
              </strong>
            ))}
            {cells.map((date) => (
              <div
                key={date}
                className={`min-h-24 border border-teal-100 p-2 ${date.startsWith(month) ? "" : "bg-slate-50 text-slate-500"}`}
              >
                <span>{Number(date.slice(-2))}</span>
                {config.cadences
                  .filter((c) => c.weeks.length && cadenceDates(c, date, date).length)
                  .map((c, i) => (
                    <p
                      className="mt-1 rounded p-1 text-xs"
                      style={{
                        background: ["#d0eee8", "#dbeafe", "#ede9fe", "#fef3c7"][i % 4],
                      }}
                      key={c.zoneId}
                    >
                      {initial.zones.find((z) => z.id === c.zoneId)?.name}{" "}
                      {c.locked ? "· locked" : "· draft"}
                    </p>
                  ))}
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Vehicle bucket capacity</h2>
        <p>
          All limits apply together. Space units prevent a mixed load of detergent and
          scent beads from exceeding the same vehicle. Set one detergent bucket to a
          practical number of units, then give other items their relative space
          requirement.
        </p>
        {initial.vehicles.map((v) => (
          <form
            key={`${v.id}-${v.updatedAt}`}
            className="space-y-4 rounded-3xl border border-teal-100 bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void save("/api/admin/vehicle-capacity", {
                id: v.id,
                updatedAt: v.updatedAt,
                capacityStops: Number(f.get("capacityStops")),
                capacityUnits: Number(f.get("capacityUnits")),
                detergentBucketLimit: Number(f.get("detergentBucketLimit")),
                scentBeadBucketLimit: Number(f.get("scentBeadBucketLimit")),
              });
            }}
          >
            <h3 className="font-semibold">{v.name}</h3>
            <CapacityFields values={v} />
            <button className="ops-button" disabled={busy}>
              Save {v.name} capacity
            </button>
          </form>
        ))}
        <ResourceForm type="vehicle" busy={busy} save={save} />
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Approved ZIP codes by zone</h2>
        {initial.zones.map((zone) => (
          <form
            key={zone.id + zone.postalCodes.join()}
            className="space-y-3 rounded-3xl border border-teal-100 bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void save("/api/admin/zone-zips", {
                id: zone.id,
                postalCodes: String(f.get("zips"))
                  .split(/[\s,]+/)
                  .filter(Boolean),
              });
            }}
          >
            <Field label={`${zone.name} ZIP codes`}>
              <Input name="zips" defaultValue={zone.postalCodes.join(", ")} required />
            </Field>
            <button className="ops-button" disabled={busy}>
              Save {zone.name} ZIP codes
            </button>
          </form>
        ))}
        <ResourceForm type="zone" busy={busy} save={save} />
      </section>
    </div>
  );
}
function CapacityFields({
  values,
}: {
  values?: {
    capacityStops: number;
    capacityUnits: number;
    detergentBucketLimit: number;
    scentBeadBucketLimit: number;
  };
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(
        [
          ["capacityStops", "Maximum stops", 1],
          ["capacityUnits", "Total vehicle space units", 1],
          ["detergentBucketLimit", "Maximum detergent buckets", 0],
          ["scentBeadBucketLimit", "Maximum scent bead buckets", 0],
        ] as const
      ).map(([key, label, min]) => (
        <Field key={key} label={label}>
          <Input
            type="number"
            name={key}
            min={min}
            max={key === "capacityUnits" ? 10000 : 1000}
            defaultValue={values?.[key] ?? min}
            required
          />
        </Field>
      ))}
    </div>
  );
}
function ResourceForm({
  type,
  busy,
  save,
}: {
  type: "zone" | "vehicle";
  busy: boolean;
  save: (path: string, data: unknown) => Promise<unknown>;
}) {
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  return (
    <form
      className="space-y-3 rounded-3xl border border-teal-100 bg-white p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const result = await save("/api/admin/launch-resource", {
          type,
          requestKey,
          name: String(f.get("name")),
          ...(type === "zone"
            ? {
                postalCodes: String(f.get("zips"))
                  .split(/[\s,]+/)
                  .filter(Boolean),
              }
            : {
                capacityStops: Number(f.get("capacityStops")),
                capacityUnits: Number(f.get("capacityUnits")),
                detergentBucketLimit: Number(f.get("detergentBucketLimit")),
                scentBeadBucketLimit: Number(f.get("scentBeadBucketLimit")),
              }),
        });
        if (result) {
          form.reset();
          setRequestKey(crypto.randomUUID());
        }
      }}
    >
      <h3 className="font-semibold">
        Add {type === "zone" ? "delivery area" : "vehicle"}
      </h3>
      <Field label="Name">
        <Input name="name" required maxLength={100} />
      </Field>
      {type === "zone" ? (
        <Field label="ZIP codes (comma separated)">
          <Input name="zips" required />
        </Field>
      ) : (
        <CapacityFields />
      )}
      <button className="ops-button secondary" disabled={busy}>
        Add {type}
      </button>
    </form>
  );
}
