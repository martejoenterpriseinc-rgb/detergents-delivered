import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  DELIVERY_SETTINGS_KEY,
  defaultDeliverySettings,
  enabledCountyNames,
  formatCountyList,
  formatDeliverySlot,
  nextDeliverySlot,
  NO_SAME_DAY_SUMMARY,
  normalizeDeliverySettings,
  parseDeliverySettings,
  serviceAreaSummary,
  weeklyDeliverySummary,
  type DeliverySettings,
} from "@/lib/domain/delivery-schedule";
import { EXAMPLE_DELIVERY_ZIP } from "@/lib/delivery-area";
import { zonePostalCodes } from "@/lib/domain/launch";

export type PublicDeliveryInfo = {
  settings: DeliverySettings;
  enabledCountyCodes: DeliverySettings["enabledCountyCodes"];
  enabledCountyNames: string[];
  countyListLabel: string;
  serviceAreaSummary: string;
  weeklySummary: string;
  nextWindowLabel: string | null;
  exampleZip: string;
  exampleZips: string[];
  zones: { code: string; name: string; towns: string; zips: string[] }[];
  noSameDaySummary: string;
};

export async function getDeliverySettings(): Promise<DeliverySettings> {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: DELIVERY_SETTINGS_KEY },
    });
    if (!row) {
      return defaultDeliverySettings();
    }
    return normalizeDeliverySettings(row.valueJson);
  } catch {
    return defaultDeliverySettings();
  }
}

export async function ensureDeliverySettingsSeeded() {
  const defaults = defaultDeliverySettings();
  await prisma.setting.upsert({
    where: { key: DELIVERY_SETTINGS_KEY },
    update: {},
    create: {
      key: DELIVERY_SETTINGS_KEY,
      valueJson: defaults as unknown as Prisma.InputJsonValue,
    },
  });
  return getDeliverySettings();
}

export async function saveDeliverySettings(
  value: unknown,
  actorUserId?: string | null,
): Promise<DeliverySettings> {
  const parsed = parseDeliverySettings(value);
  const existing = await prisma.setting.findUnique({
    where: { key: DELIVERY_SETTINGS_KEY },
  });
  const row = await prisma.setting.upsert({
    where: { key: DELIVERY_SETTINGS_KEY },
    update: { valueJson: parsed as unknown as Prisma.InputJsonValue },
    create: {
      key: DELIVERY_SETTINGS_KEY,
      valueJson: parsed as unknown as Prisma.InputJsonValue,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: existing ? "delivery.settings.update" : "delivery.settings.create",
    entityType: "Setting",
    entityId: row.id,
    beforeJson: (existing?.valueJson ?? undefined) as Prisma.InputJsonValue | undefined,
    afterJson: parsed as unknown as Prisma.InputJsonValue,
  });
  return parsed;
}

export async function getPublicDeliveryInfo(
  now = new Date(),
): Promise<PublicDeliveryInfo> {
  const settings = await getDeliverySettings();
  const slot = nextDeliverySlot(settings, now);
  const names = enabledCountyNames(settings);
  const configured = await prisma.deliveryZone.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  const zones = configured
    .map((zone) => ({
      code: zone.slug,
      name: zone.name,
      towns: "Only listed ZIP codes are eligible for address validation.",
      zips: zonePostalCodes(zone.boundaryJson),
    }))
    .filter((zone) => zone.zips.length > 0);
  const zips = zones.flatMap((zone) => zone.zips);
  return {
    settings,
    enabledCountyCodes: settings.enabledCountyCodes,
    enabledCountyNames: names,
    countyListLabel: formatCountyList(names),
    serviceAreaSummary: serviceAreaSummary(settings),
    weeklySummary: weeklyDeliverySummary(settings),
    nextWindowLabel: slot ? formatDeliverySlot(slot, settings.timezone) : null,
    exampleZip: zips[0] ?? EXAMPLE_DELIVERY_ZIP,
    exampleZips: zips,
    zones,
    noSameDaySummary: NO_SAME_DAY_SUMMARY,
  };
}
