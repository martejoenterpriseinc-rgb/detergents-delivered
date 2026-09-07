/** Demo delivery coverage for the storefront mockup. Not live routing. */

export const DEMO_DELIVERY_ZONES = [
  {
    name: "Des Moines core",
    zips: ["50309", "50310", "50311", "50312", "50314", "50315", "50316", "50317"],
  },
  {
    name: "West metro",
    zips: ["50265", "50266", "50322", "50323", "50324", "50325"],
  },
  {
    name: "North metro",
    zips: ["50021", "50023", "50313", "50320", "50321", "50327"],
  },
] as const;

export const DEMO_DELIVERY_ZIPS = DEMO_DELIVERY_ZONES.flatMap((zone) => [...zone.zips]);

export type DeliveryCheckResult =
  | { ok: true; zip: string; zoneName: string; message: string }
  | { ok: false; zip: string; message: string };

export function normalizeZip(input: string) {
  return input.replace(/\D/g, "").slice(0, 5);
}

export function zoneNameForZip(zip: string) {
  const normalized = normalizeZip(zip);
  const zone = DEMO_DELIVERY_ZONES.find((entry) =>
    (entry.zips as readonly string[]).includes(normalized),
  );
  return zone?.name ?? null;
}

export function checkDeliveryZip(input: string): DeliveryCheckResult {
  const zip = normalizeZip(input);
  if (zip.length !== 5) {
    return {
      ok: false,
      zip,
      message: "Enter a 5-digit U.S. ZIP code.",
    };
  }
  const zoneName = zoneNameForZip(zip);
  if (!zoneName) {
    return {
      ok: false,
      zip,
      message: `${zip} is outside our demo delivery area. Try 50309 or another listed ZIP.`,
    };
  }
  return {
    ok: true,
    zip,
    zoneName,
    message: `Yes — we deliver to ${zip} (${zoneName}). Same-week drop-off on your chosen day.`,
  };
}
