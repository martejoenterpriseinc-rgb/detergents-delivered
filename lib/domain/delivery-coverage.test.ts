import { describe, it, expect } from "vitest";
import {
  eligiblePostalCodes,
  parsePostalLocation,
  coverageViewport,
  mercator,
  zoomCoverageViewport,
} from "./delivery-coverage";
describe("public delivery map", () => {
  it("zooms around the same geographic center and bounds tile zoom levels", () => {
    const fit = coverageViewport([
      { postalCode: "60102", latitude: 42.16, longitude: -88.3, placeName: "Algonquin" },
    ])!;
    const zoomed = zoomCoverageViewport(fit, 2);
    const center = mercator(42.16, -88.3, zoomed.zoom);
    expect(center.x - zoomed.left).toBeCloseTo(360);
    expect(center.y - zoomed.top).toBeCloseTo(150);
    expect(zoomCoverageViewport(fit, 99).zoom).toBe(16);
    expect(zoomCoverageViewport(fit, -99).zoom).toBe(0);
    expect(zoomCoverageViewport(fit, 0)).toEqual(fit);
  });
  it("uses explicit unique ZIPs and excludes ambiguous zones", () => {
    expect(
      eligiblePostalCodes([
        { boundaryJson: { postalCodes: ["60102", "60014"] } },
        { boundaryJson: { postalCodes: ["60102", "60601"] } },
      ]),
    ).toEqual(["60014", "60601"]);
    expect(eligiblePostalCodes([{ boundaryJson: { county: "Cook" } }])).toEqual([]);
  });
  it("rejects mismatched ZIPs, invalid coordinates and non-US lookup results", () => {
    const raw = {
      "post code": "60102",
      "country abbreviation": "US",
      places: [{ latitude: "42.16", longitude: "-88.3", "place name": "Algonquin" }],
    };
    expect(parsePostalLocation("60102", raw)?.placeName).toBe("Algonquin");
    expect(parsePostalLocation("60014", raw)).toBeNull();
    expect(
      parsePostalLocation("60102", { ...raw, "country abbreviation": "CA" }),
    ).toBeNull();
    for (const latitude of ["", "NaN", "Infinity", "91"])
      expect(
        parsePostalLocation("60102", {
          ...raw,
          places: [{ latitude, longitude: "-88.3" }],
        }),
      ).toBeNull();
  });
  it("fits every known center as coverage grows without inventing points", () => {
    const points = [
      { postalCode: "60102", latitude: 42.16, longitude: -88.3, placeName: "Algonquin" },
      {
        postalCode: "90210",
        latitude: 34.09,
        longitude: -118.4,
        placeName: "Beverly Hills",
      },
    ];
    const small = coverageViewport(points.slice(0, 1))!,
      large = coverageViewport(points)!;
    expect(large.zoom).toBeLessThan(small.zoom);
    for (const point of points) {
      const p = mercator(point.latitude, point.longitude, large.zoom);
      expect(p.x - large.left).toBeGreaterThanOrEqual(50);
      expect(p.x - large.left).toBeLessThanOrEqual(large.width - 50);
      expect(p.y - large.top).toBeGreaterThanOrEqual(50);
      expect(p.y - large.top).toBeLessThanOrEqual(large.height - 50);
    }
    expect(coverageViewport([])).toBeNull();
  });
});
