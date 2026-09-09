import { describe, it, expect } from "vitest";
import { businessDate, dateSchema, wazeUrl, validPoint, monthStart } from "./operations";
import { csvText } from "./operations-export";
describe("operations date and navigation boundaries", () => {
  it("uses Chicago calendar dates across daylight saving and month boundaries", () => {
    expect(businessDate(new Date("2026-03-01T05:59:59Z"))).toBe("2026-02-28");
    expect(businessDate(new Date("2026-07-01T04:59:59Z"))).toBe("2026-06-30");
    expect(monthStart("2026-06-30")).toBe("2026-06-01");
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
  });
  it("does not invent coordinates or a Waze ETA", () => {
    expect(validPoint(null, -88)).toBe(false);
    expect(wazeUrl(Infinity, 0)).toBeNull();
    expect(wazeUrl(42.165, -88.294)).toBe(
      "https://waze.com/ul?ll=42.165%2C-88.294&navigate=yes&utm_source=detergentsdelivered",
    );
  });
  it("neutralizes spreadsheet formulas and escapes quotes", () => {
    expect(csvText([["=1+1", 'A "name"']])).toBe('"\'=1+1","A ""name"""');
  });
});
