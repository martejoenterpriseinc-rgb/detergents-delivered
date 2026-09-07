import { describe, expect, it } from "vitest";
import {
  defaultDeliverySettings,
  formatCountyList,
  formatDeliverySlot,
  nextDeliverySlot,
  NO_SAME_DAY_SUMMARY,
  parseDeliverySettings,
  weeklyDeliverySummary,
} from "./delivery-schedule";

describe("delivery schedule", () => {
  const settings = defaultDeliverySettings();

  it("defaults to Tue/Thu windows and McHenry, Kane, Cook", () => {
    expect(settings.enabledCountyCodes).toEqual(["mchenry", "kane", "cook"]);
    expect(settings.days.filter((day) => day.enabled).map((day) => day.weekday)).toEqual([
      2, 4,
    ]);
    expect(weeklyDeliverySummary(settings)).toContain("Tuesday");
    expect(weeklyDeliverySummary(settings)).toContain("Thursday");
    expect(NO_SAME_DAY_SUMMARY.toLowerCase()).toContain("do not offer same-day");
  });

  it("returns Tuesday when now is Monday before the cutoff", () => {
    const now = new Date("2026-09-07T15:00:00.000Z");
    const slot = nextDeliverySlot(settings, now);
    expect(slot).not.toBeNull();
    expect(slot?.weekdayName).toBe("Tuesday");
    expect(formatDeliverySlot(slot!)).toMatch(/Tuesday/i);
    expect(formatDeliverySlot(slot!).toLowerCase()).not.toMatch(/same[- ]day/);
  });

  it("never returns the same calendar day even before the window", () => {
    const now = new Date("2026-09-08T13:00:00.000Z");
    const slot = nextDeliverySlot(settings, now);
    expect(slot?.weekdayName).toBe("Thursday");
  });

  it("skips a day after its cutoff and uses the next enabled day", () => {
    const now = new Date("2026-09-08T03:00:00.000Z");
    const slot = nextDeliverySlot(settings, now);
    expect(slot?.weekdayName).toBe("Thursday");
  });

  it("returns null when no route days are enabled", () => {
    const empty = {
      ...settings,
      days: settings.days.map((day) => ({ ...day, enabled: false })),
    };
    expect(nextDeliverySlot(empty, new Date("2026-09-07T15:00:00.000Z"))).toBeNull();
  });

  it("rejects invalid windows and drops unknown county codes", () => {
    expect(() =>
      parseDeliverySettings({
        ...settings,
        days: settings.days.map((day) =>
          day.weekday === 2 ? { ...day, windowStart: "16:00", windowEnd: "09:00" } : day,
        ),
      }),
    ).toThrow(/window start/);
    const parsed = parseDeliverySettings({
      ...settings,
      enabledCountyCodes: ["mchenry", "not-a-county", "cook"],
    });
    expect(parsed.enabledCountyCodes).toEqual(["mchenry", "cook"]);
    expect(formatCountyList(["McHenry", "Kane", "Cook"])).toBe("McHenry, Kane, and Cook");
  });
});
