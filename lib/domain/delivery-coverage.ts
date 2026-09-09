import { zonePostalCodes } from "./launch";
export type CoveragePoint = {
  postalCode: string;
  latitude: number;
  longitude: number;
  placeName: string;
};
export type DeliveryCoverage = { postalCodes: string[]; points: CoveragePoint[] };
// Mirror checkout: duplicate ZIPs in different active zones are unavailable.
export function eligiblePostalCodes(zones: Array<{ boundaryJson: unknown }>): string[] {
  const counts = new Map<string, number>();
  for (const zone of zones)
    for (const zip of new Set(zonePostalCodes(zone.boundaryJson)))
      counts.set(zip, (counts.get(zip) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count === 1)
    .map(([zip]) => zip)
    .sort();
}
export function parsePostalLocation(
  postalCode: string,
  raw: unknown,
): CoveragePoint | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (
    data["post code"] !== postalCode ||
    data["country abbreviation"] !== "US" ||
    !Array.isArray(data.places)
  )
    return null;
  for (const item of data.places.slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    const place = item as Record<string, unknown>;
    if (
      typeof place.latitude !== "string" ||
      typeof place.longitude !== "string" ||
      !place.latitude.trim() ||
      !place.longitude.trim()
    )
      continue;
    const latitude = Number(place.latitude),
      longitude = Number(place.longitude);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 85 ||
      Math.abs(longitude) > 180
    )
      continue;
    return {
      postalCode,
      latitude,
      longitude,
      placeName:
        typeof place["place name"] === "string"
          ? place["place name"].slice(0, 120)
          : postalCode,
    };
  }
  return null;
}
// Web Mercator in tile coordinates, shared by map fitting and its markers.
export function mercator(latitude: number, longitude: number, zoom: number) {
  const n = 2 ** zoom,
    lat = (Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180;
  return {
    x: ((longitude + 180) / 360) * n * 256,
    y: ((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * n * 256,
  };
}
export function coverageViewport(points: CoveragePoint[], width = 720, height = 300) {
  if (!points.length) return null;
  for (let zoom = 11; zoom >= 0; zoom--) {
    const positions = points.map((p) => mercator(p.latitude, p.longitude, zoom));
    const xs = positions.map((p) => p.x),
      ys = positions.map((p) => p.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    if (maxX - minX <= width - 100 && maxY - minY <= height - 100)
      return {
        zoom,
        left: (minX + maxX - width) / 2,
        top: (minY + maxY - height) / 2,
        width,
        height,
      };
  }
  return null;
}

export function zoomCoverageViewport(
  viewport: NonNullable<ReturnType<typeof coverageViewport>>,
  offset: number,
) {
  const zoom = Math.max(0, Math.min(16, viewport.zoom + offset));
  const factor = 2 ** (zoom - viewport.zoom);
  return {
    ...viewport,
    zoom,
    left: (viewport.left + viewport.width / 2) * factor - viewport.width / 2,
    top: (viewport.top + viewport.height / 2) * factor - viewport.height / 2,
  };
}
