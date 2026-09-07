"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminFetch } from "@/lib/admin-fetch";
import {
  CHICAGOLAND_COUNTIES,
  CHICAGO_TIME_ZONE,
  WEEKDAYS,
  type CountyCode,
  type DeliverySettings,
} from "@/lib/domain/delivery-schedule";

export function DeliverySettingsForm({
  initial,
  canWrite,
}: {
  initial: DeliverySettings;
  canWrite: boolean;
}) {
  const [settings, setSettings] = useState<DeliverySettings>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  function toggleCounty(code: CountyCode) {
    setSaved(false);
    setSettings((current) => {
      const enabled = current.enabledCountyCodes.includes(code)
        ? current.enabledCountyCodes.filter((item) => item !== code)
        : [...current.enabledCountyCodes, code];
      return { ...current, enabledCountyCodes: enabled };
    });
  }

  function updateDay(weekday: number, patch: Partial<DeliverySettings["days"][number]>) {
    setSaved(false);
    setSettings((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.weekday === weekday ? { ...day, ...patch } : day,
      ),
    }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminFetch<{ settings: DeliverySettings }>(
        "/api/delivery/settings",
        {
          method: "PUT",
          body: JSON.stringify(settings),
        },
      );
      setSettings(result.settings);
      setSaved(true);
    } catch (next) {
      setError(next instanceof Error ? next.message : "Could not save settings");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-teal-950">Service counties</h2>
          <p className="mt-1 text-sm text-teal-800">
            Toggle which Chicagoland-area counties are enabled. Seed/staging defaults are
            McHenry, Kane, and Cook only. Town lists stay select-area — enabling a county
            does not mean every ZIP in that county.
          </p>
        </div>
        <fieldset
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          disabled={!canWrite}
        >
          <legend className="sr-only">Enabled counties</legend>
          {CHICAGOLAND_COUNTIES.map((county) => (
            <label
              key={county.code}
              className="flex items-center gap-2 rounded-2xl border border-teal-100 px-3 py-2 text-sm text-teal-900"
            >
              <input
                type="checkbox"
                checked={settings.enabledCountyCodes.includes(county.code)}
                onChange={() => toggleCounty(county.code)}
              />
              {county.name} County
            </label>
          ))}
        </fieldset>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-teal-950">Weekly route days</h2>
          <p className="mt-1 text-sm text-teal-800">
            Delivery is weekly on the days you enable — not same-day and not any day.
            Times are {CHICAGO_TIME_ZONE}. Seed defaults are Tuesday and Thursday 9:00
            AM–3:00 PM with a 12-hour cutoff; those values are editable here.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="text-xs tracking-wide text-teal-700 uppercase">
                <th className="pb-2 font-semibold">Day</th>
                <th className="pb-2 font-semibold">On</th>
                <th className="pb-2 font-semibold">Window start</th>
                <th className="pb-2 font-semibold">Window end</th>
                <th className="pb-2 font-semibold">Cutoff hours before</th>
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((meta) => {
                const day = settings.days.find((entry) => entry.weekday === meta.weekday);
                if (!day) return null;
                return (
                  <tr key={meta.weekday} className="border-t border-teal-100">
                    <td className="py-3 font-medium text-teal-950">{meta.name}</td>
                    <td className="py-3">
                      <input
                        type="checkbox"
                        checked={day.enabled}
                        disabled={!canWrite}
                        onChange={(event) =>
                          updateDay(meta.weekday, { enabled: event.target.checked })
                        }
                      />
                    </td>
                    <td className="py-3 pr-2">
                      <Input
                        type="time"
                        value={day.windowStart}
                        disabled={!canWrite}
                        onChange={(event) =>
                          updateDay(meta.weekday, { windowStart: event.target.value })
                        }
                      />
                    </td>
                    <td className="py-3 pr-2">
                      <Input
                        type="time"
                        value={day.windowEnd}
                        disabled={!canWrite}
                        onChange={(event) =>
                          updateDay(meta.weekday, { windowEnd: event.target.value })
                        }
                      />
                    </td>
                    <td className="py-3">
                      <Input
                        type="number"
                        min={0}
                        max={72}
                        step={1}
                        value={day.cutoffHoursBefore}
                        disabled={!canWrite}
                        onChange={(event) =>
                          updateDay(meta.weekday, {
                            cutoffHoursBefore: Number(event.target.value || 0),
                          })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {error ? (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</p>
      ) : null}
      {saved ? (
        <p className="rounded-2xl bg-teal-50 px-4 py-3 text-sm text-teal-900">
          Delivery settings saved. Storefront copy and the ZIP checker will use the
          enabled counties and next weekly window.
        </p>
      ) : null}
      <Button type="submit" disabled={!canWrite || pending}>
        {pending ? "Saving…" : canWrite ? "Save delivery settings" : "Read only"}
      </Button>
    </form>
  );
}
