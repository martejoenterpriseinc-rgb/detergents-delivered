import { describe, it, expect } from "vitest";
import {
  fitsVehicle,
  loadForItems,
  addLoad,
  emptyLoad,
  defaultLaunch,
  launchSchema,
  cadenceDates,
  zonePostalCodes,
  calendarWeek,
  deliveryBookingWindow,
} from "./launch";
describe("launch and mixed vehicle capacity", () => {
  const capacity = {
    capacityStops: 2,
    capacityUnits: 12,
    detergentBucketLimit: 3,
    scentBeadBucketLimit: 6,
  };
  it("enforces shared space even when individual bucket limits pass", () => {
    const detergent = loadForItems([{ quantity: 3, units: 3, kind: "DETERGENT" }]);
    const beads = loadForItems([{ quantity: 4, units: 1, kind: "SCENT_BEADS" }]);
    expect(fitsVehicle(capacity, detergent)).toBe(true);
    expect(fitsVehicle(capacity, addLoad(detergent, beads))).toBe(false);
    expect(
      fitsVehicle({ ...capacity, capacityUnits: 13 }, addLoad(detergent, beads)),
    ).toBe(true);
  });
  it("counts all products and rejects zero, fractional or overflowing loads", () => {
    expect(loadForItems([{ quantity: 2, units: 4, kind: "OTHER" }]).units).toBe(8);
    for (const units of [0, -1, 0.5, Number.MAX_SAFE_INTEGER])
      expect(() => loadForItems([{ quantity: 2, units, kind: "OTHER" }])).toThrow();
    expect(fitsVehicle(capacity, { ...emptyLoad(), stops: 3 })).toBe(false);
    expect(fitsVehicle(capacity, { ...emptyLoad(), detergent: 4 })).toBe(false);
    expect(fitsVehicle(capacity, { ...emptyLoad(), scentBeads: 7 })).toBe(false);
  });
  it("validates cutoff, first-delivery deadline and duplicate zone assignments", () => {
    expect(defaultLaunch.enabled).toBe(false);
    expect(
      launchSchema.safeParse({ ...defaultLaunch, cutoffDate: "2026-10-16" }).success,
    ).toBe(false);
    expect(
      launchSchema.safeParse({ ...defaultLaunch, firstDeliveryBy: "2026-10-01" }).success,
    ).toBe(false);
    expect(
      launchSchema.safeParse({ ...defaultLaunch, launchDate: "2026-02-30" }).success,
    ).toBe(false);
    const cadence = { zoneId: "z", vehicleId: "v", weeks: [1], weekday: 4, locked: true };
    expect(
      launchSchema.safeParse({ ...defaultLaunch, cadences: [cadence, cadence] }).success,
    ).toBe(false);
  });
  it("resolves calendar rows including a sixth week without timezone drift", () => {
    expect(calendarWeek("2026-03-31")).toBe(6);
    const cadence = {
      zoneId: "z",
      vehicleId: "v",
      weeks: [3, 4, 5],
      weekday: 4,
      locked: true,
    };
    expect(cadenceDates(cadence, "2026-10-15", "2026-10-31")).toEqual([
      "2026-10-15",
      "2026-10-22",
      "2026-10-29",
    ]);
  });
  it("never treats arbitrary boundary JSON or malformed ZIPs as approval", () => {
    expect(zonePostalCodes({ type: "Polygon", coordinates: [] })).toEqual([]);
    expect(zonePostalCodes({ postalCodes: ["60102", "60102"] })).toEqual(["60102"]);
    expect(zonePostalCodes({ postalCodes: ["60102", "6010"] })).toEqual([]);
  });
});

describe("ongoing delivery booking", () => {
  const config = {
    ...defaultLaunch,
    enabled: true,
    rolling: { enabled: true, leadDays: 2, horizonDays: 30 },
  };
  it("keeps legacy settings closed after cutoff and does not bypass the prelaunch gap", () => {
    expect(
      deliveryBookingWindow({ ...defaultLaunch, enabled: true }, "2026-11-01"),
    ).toBeNull();
    expect(deliveryBookingWindow({ ...config, enabled: false }, "2026-11-01")).toBeNull();
    expect(
      deliveryBookingWindow({ ...config, cutoffDate: "2026-10-10" }, "2026-10-12"),
    ).toBeNull();
    expect(deliveryBookingWindow(config, "2026-10-14")).toEqual({
      start: "2026-10-15",
      end: "2026-10-31",
      kind: "LAUNCH",
    });
  });
  it("uses calendar-day lead and horizon across month/year and leap boundaries", () => {
    expect(deliveryBookingWindow(config, "2026-12-31")).toEqual({
      start: "2027-01-02",
      end: "2027-01-30",
      kind: "ROLLING",
    });
    expect(deliveryBookingWindow(config, "2028-02-28")?.start).toBe("2028-03-01");
    expect(() => deliveryBookingWindow(config, "2026-02-30")).toThrow();
  });
  it("rejects unsafe lead/horizon settings and unknown overrides", () => {
    for (const rolling of [
      { enabled: true, leadDays: 0, horizonDays: 30 },
      { enabled: true, leadDays: 7, horizonDays: 7 },
      { enabled: true, leadDays: 2, horizonDays: 91 },
      { enabled: true, leadDays: 1.5, horizonDays: 30 },
      { enabled: true, leadDays: 2, horizonDays: 30, ignoreCapacity: true },
    ])
      expect(launchSchema.safeParse({ ...config, rolling }).success).toBe(false);
    expect(launchSchema.parse(defaultLaunch).rolling).toBeUndefined();
  });
});
