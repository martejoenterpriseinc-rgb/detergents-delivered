import {
  defaultDeliverySettings,
  NO_SAME_DAY_SUMMARY,
  type CountyCode,
} from "@/lib/domain/delivery-schedule";

export const EXAMPLE_DELIVERY_ZIP = "60014";
export const EXAMPLE_DELIVERY_CITY = "Crystal Lake";
export const EXAMPLE_DELIVERY_REGION = "IL";

export const NO_SAME_DAY_COPY = NO_SAME_DAY_SUMMARY;

export type CountyDeliveryArea = {
  code: CountyCode;
  name: string;
  towns: string;
  zips: readonly string[];
};

export const COUNTY_DELIVERY_AREAS: readonly CountyDeliveryArea[] = [
  {
    code: "mchenry",
    name: "McHenry County select",
    towns:
      "Crystal Lake, McHenry, Woodstock, Huntley, Algonquin, Cary, Lake in the Hills",
    zips: ["60014", "60050", "60098", "60142", "60102", "60013", "60156"],
  },
  {
    code: "kane",
    name: "Kane County select",
    towns: "Elgin, South Elgin, St. Charles, Geneva, Batavia, Carpentersville",
    zips: ["60120", "60123", "60177", "60174", "60134", "60510", "60110"],
  },
  {
    code: "cook",
    name: "Cook County select",
    towns: "Schaumburg, Palatine, Arlington Heights, Hoffman Estates, Streamwood",
    zips: ["60193", "60067", "60004", "60169", "60107"],
  },
  {
    code: "dupage",
    name: "DuPage County select",
    towns: "Naperville, Wheaton, Downers Grove, Elmhurst, Lombard",
    zips: ["60540", "60187", "60515", "60126", "60148"],
  },
  {
    code: "lake",
    name: "Lake County select",
    towns: "Waukegan, Libertyville, Vernon Hills, Gurnee, Lake Forest",
    zips: ["60085", "60048", "60061", "60031", "60045"],
  },
  {
    code: "will",
    name: "Will County select",
    towns: "Joliet, Plainfield, Bolingbrook, Romeoville",
    zips: ["60435", "60586", "60440", "60446"],
  },
  {
    code: "kendall",
    name: "Kendall County select",
    towns: "Yorkville, Oswego, Montgomery",
    zips: ["60560", "60543", "60538"],
  },
  {
    code: "grundy",
    name: "Grundy County select",
    towns: "Morris, Minooka",
    zips: ["60450", "60447"],
  },
  {
    code: "dekalb",
    name: "DeKalb County select",
    towns: "DeKalb, Sycamore",
    zips: ["60115", "60178"],
  },
];

export function deliveryZonesForCounties(countyCodes: readonly string[]) {
  const enabled = new Set(countyCodes);
  return COUNTY_DELIVERY_AREAS.filter((area) => enabled.has(area.code));
}

export const DEMO_DELIVERY_ZONES = deliveryZonesForCounties(
  defaultDeliverySettings().enabledCountyCodes,
);

export function deliveryZipsForCounties(countyCodes: readonly string[]) {
  return deliveryZonesForCounties(countyCodes).flatMap((zone) => [...zone.zips]);
}

export const DEMO_DELIVERY_ZIPS = deliveryZipsForCounties(
  defaultDeliverySettings().enabledCountyCodes,
);

export type DeliveryCheckOptions = {
  enabledCountyCodes?: readonly string[];
  nextWindowLabel?: string | null;
};

export type DeliveryCheckResult =
  | { ok: true; zip: string; zoneName: string; message: string }
  | { ok: false; zip: string; message: string };

export function normalizeZip(input: string) {
  return input.replace(/\D/g, "").slice(0, 5);
}

export function zoneForZip(zip: string, countyCodes?: readonly string[]) {
  const normalized = normalizeZip(zip);
  const zones = countyCodes
    ? deliveryZonesForCounties(countyCodes)
    : COUNTY_DELIVERY_AREAS;
  return zones.find((entry) => entry.zips.includes(normalized)) ?? null;
}

export function zoneNameForZip(zip: string, countyCodes?: readonly string[]) {
  return zoneForZip(zip, countyCodes)?.name ?? null;
}

export function checkDeliveryZip(
  input: string,
  options: DeliveryCheckOptions = {},
): DeliveryCheckResult {
  const zip = normalizeZip(input);
  const enabledCountyCodes =
    options.enabledCountyCodes ?? defaultDeliverySettings().enabledCountyCodes;
  if (zip.length !== 5) {
    return {
      ok: false,
      zip,
      message: "Enter a 5-digit U.S. ZIP code.",
    };
  }
  const zone = zoneForZip(zip, enabledCountyCodes);
  if (!zone) {
    return {
      ok: false,
      zip,
      message: `${zip} is outside our current select Chicagoland delivery area. Try ${EXAMPLE_DELIVERY_ZIP} or another listed ZIP.`,
    };
  }
  const windowNote = options.nextWindowLabel
    ? ` Next available window: ${options.nextWindowLabel}.`
    : "";
  return {
    ok: true,
    zip,
    zoneName: zone.name,
    message: `Yes — we deliver to ${zip} (${zone.name}). Weekly delivery on scheduled route days.${windowNote} ${NO_SAME_DAY_SUMMARY}`,
  };
}
