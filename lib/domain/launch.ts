import { z } from "zod";
import { dateSchema } from "./operations";

export const LAUNCH_KEY = "commerce.launch";
export const loadKinds = ["DETERGENT", "SCENT_BEADS", "OTHER"] as const;
export const capacitySchema = z
  .object({
    capacityStops: z.number().int().min(1).max(1000),
    capacityUnits: z.number().int().min(1).max(10000),
    detergentBucketLimit: z.number().int().min(0).max(1000),
    scentBeadBucketLimit: z.number().int().min(0).max(1000),
  })
  .strict();
export type Capacity = z.infer<typeof capacitySchema>;
export type Load = {
  stops: number;
  units: number;
  detergent: number;
  scentBeads: number;
};
export function loadForItems(
  items: { quantity: number; units: number; kind: string }[],
): Load {
  const load: Load = { stops: 1, units: 0, detergent: 0, scentBeads: 0 };
  for (const item of items) {
    if (![item.quantity, item.units].every((n) => Number.isSafeInteger(n) && n > 0))
      throw new Error(
        "Every item needs a positive quantity and vehicle space allocation.",
      );
    load.units += item.units * item.quantity;
    if (item.kind === "DETERGENT") load.detergent += item.quantity;
    if (item.kind === "SCENT_BEADS") load.scentBeads += item.quantity;
  }
  if (!Number.isSafeInteger(load.units)) throw new Error("Vehicle load is too large.");
  return load;
}
export const emptyLoad = (): Load => ({
  stops: 0,
  units: 0,
  detergent: 0,
  scentBeads: 0,
});
export function addLoad(a: Load, b: Load): Load {
  return {
    stops: a.stops + b.stops,
    units: a.units + b.units,
    detergent: a.detergent + b.detergent,
    scentBeads: a.scentBeads + b.scentBeads,
  };
}
export function fitsVehicle(capacity: Capacity, load: Load) {
  capacitySchema.parse(capacity);
  return (
    Object.values(load).every((n) => Number.isSafeInteger(n) && n >= 0) &&
    load.stops <= capacity.capacityStops &&
    load.units <= capacity.capacityUnits &&
    load.detergent <= capacity.detergentBucketLimit &&
    load.scentBeads <= capacity.scentBeadBucketLimit
  );
}
export const cadenceSchema = z
  .object({
    zoneId: z.string().min(1).max(100),
    vehicleId: z.string().min(1).max(100),
    weeks: z.array(z.number().int().min(1).max(6)).min(1).max(6),
    weekday: z.number().int().min(0).max(6),
    locked: z.boolean(),
  })
  .strict();
export const launchSchema = z
  .object({
    version: z.number().int().min(0),
    enabled: z.boolean(),
    launchDate: dateSchema,
    cutoffDate: dateSchema,
    firstDeliveryBy: dateSchema,
    cadences: z.array(cadenceSchema).max(100),
    rolling: z
      .object({
        enabled: z.boolean(),
        leadDays: z.number().int().min(1).max(30),
        horizonDays: z.number().int().min(7).max(90),
      })
      .strict()
      .refine(
        (v) => v.horizonDays > v.leadDays,
        "The booking horizon must be longer than the delivery lead time.",
      )
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.cutoffDate > v.launchDate || v.firstDeliveryBy < v.launchDate)
      ctx.addIssue({
        code: "custom",
        message:
          "Cutoff must be on or before launch; the first-delivery deadline must be on or after launch.",
      });
    if ((Date.parse(v.firstDeliveryBy) - Date.parse(v.launchDate)) / 86400000 > 366)
      ctx.addIssue({
        code: "custom",
        message: "The first delivery window cannot exceed one year.",
      });
    if (
      new Set(v.cadences.map((c) => c.zoneId)).size !== v.cadences.length ||
      v.cadences.some((c) => new Set(c.weeks).size !== c.weeks.length)
    )
      ctx.addIssue({ code: "custom", message: "Choose each zone and week only once." });
  });
export type LaunchConfig = z.infer<typeof launchSchema>;
export const defaultLaunch: LaunchConfig = {
  version: 0,
  enabled: false,
  launchDate: "2026-10-15",
  cutoffDate: "2026-10-14",
  firstDeliveryBy: "2026-10-31",
  cadences: [],
};
// Week one is the first calendar row (Monday–Sunday), including partial weeks.
export function calendarWeek(date: string) {
  const d = new Date(dateSchema.parse(date));
  const first = new Date(`${date.slice(0, 7)}-01`);
  return Math.floor((d.getUTCDate() - 1 + ((first.getUTCDay() + 6) % 7)) / 7) + 1;
}
export function cadenceDates(
  cadence: z.infer<typeof cadenceSchema>,
  start: string,
  end: string,
) {
  const dates: string[] = [];
  const cursor = new Date(dateSchema.parse(start));
  const finish = new Date(dateSchema.parse(end));
  if ((finish.getTime() - cursor.getTime()) / 86400000 > 366)
    throw new Error("Choose a window of one year or less.");
  while (cursor <= finish) {
    const date = cursor.toISOString().slice(0, 10);
    if (
      cursor.getUTCDay() === cadence.weekday &&
      cadence.weeks.includes(calendarWeek(date))
    )
      dates.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
export function zonePostalCodes(boundary: unknown): string[] {
  const parsed = z
    .object({ postalCodes: z.array(z.string().regex(/^\d{5}$/)).max(500) })
    .safeParse(boundary);
  return parsed.success ? [...new Set(parsed.data.postalCodes)] : [];
}

/** Saved launch promises remain fixed. Ongoing booking is an explicit opt-in. */
export function deliveryBookingWindow(
  config: LaunchConfig,
  today: string,
): { start: string; end: string; kind: "LAUNCH" | "ROLLING" } | null {
  dateSchema.parse(today);
  if (!config.enabled) return null;
  if (today <= config.cutoffDate && today <= config.firstDeliveryBy)
    return {
      start: config.launchDate > today ? config.launchDate : today,
      end: config.firstDeliveryBy,
      kind: "LAUNCH",
    };
  // Never bypass the launch cutoff before opening day.
  if (!config.rolling?.enabled || today < config.launchDate) return null;
  const add = (days: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return {
    start: add(config.rolling.leadDays),
    end: add(config.rolling.horizonDays),
    kind: "ROLLING",
  };
}
