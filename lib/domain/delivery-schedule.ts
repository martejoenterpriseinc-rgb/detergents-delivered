export const DELIVERY_SETTINGS_KEY = "delivery.settings";

export const CHICAGO_TIME_ZONE = "America/Chicago";

export const WEEKDAYS = [
  { weekday: 0, name: "Sunday", short: "Sun" },
  { weekday: 1, name: "Monday", short: "Mon" },
  { weekday: 2, name: "Tuesday", short: "Tue" },
  { weekday: 3, name: "Wednesday", short: "Wed" },
  { weekday: 4, name: "Thursday", short: "Thu" },
  { weekday: 5, name: "Friday", short: "Fri" },
  { weekday: 6, name: "Saturday", short: "Sat" },
] as const;

export type Weekday = (typeof WEEKDAYS)[number]["weekday"];

export const CHICAGOLAND_COUNTIES = [
  { code: "cook", name: "Cook" },
  { code: "dupage", name: "DuPage" },
  { code: "kane", name: "Kane" },
  { code: "lake", name: "Lake" },
  { code: "mchenry", name: "McHenry" },
  { code: "will", name: "Will" },
  { code: "kendall", name: "Kendall" },
  { code: "grundy", name: "Grundy" },
  { code: "dekalb", name: "DeKalb" },
] as const;

export type CountyCode = (typeof CHICAGOLAND_COUNTIES)[number]["code"];

export const DEFAULT_ENABLED_COUNTY_CODES: CountyCode[] = ["mchenry", "kane", "cook"];

export type DeliveryDayConfig = {
  weekday: Weekday;
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  cutoffHoursBefore: number;
};

export type DeliverySettings = {
  timezone: string;
  days: DeliveryDayConfig[];
  enabledCountyCodes: CountyCode[];
};

export type DeliverySlot = {
  weekday: Weekday;
  weekdayName: string;
  windowStart: Date;
  windowEnd: Date;
  cutoffAt: Date;
};

export const NO_SAME_DAY_SUMMARY =
  "We do not offer same-day delivery. Weekly delivery runs only on scheduled route days.";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class DeliveryScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryScheduleError";
  }
}

export function weekdayName(weekday: number) {
  return WEEKDAYS.find((day) => day.weekday === weekday)?.name ?? `Day ${weekday}`;
}

export function formatCountyList(names: readonly string[]) {
  if (names.length === 0) return "no counties enabled yet";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function countyNameForCode(code: string) {
  return CHICAGOLAND_COUNTIES.find((county) => county.code === code)?.name ?? code;
}

export function enabledCountyNames(settings: DeliverySettings) {
  return settings.enabledCountyCodes.map(countyNameForCode);
}

export function enabledRouteDayNames(settings: DeliverySettings) {
  return settings.days
    .filter((day) => day.enabled)
    .map((day) => weekdayName(day.weekday));
}

export function formatTimeRange(start: string, end: string) {
  return `${formatClock(start)}–${formatClock(end)}`;
}

export function formatClock(value: string) {
  const parsed = parseClock(value);
  if (!parsed) return value;
  const suffix = parsed.hour >= 12 ? "PM" : "AM";
  const hour12 = parsed.hour % 12 === 0 ? 12 : parsed.hour % 12;
  return `${hour12}:${String(parsed.minute).padStart(2, "0")} ${suffix}`;
}

export function weeklyDeliverySummary(settings: DeliverySettings) {
  const days = settings.days.filter((day) => day.enabled);
  if (days.length === 0) {
    return "Weekly delivery days are not configured yet.";
  }
  const parts = days.map(
    (day) =>
      `${weekdayName(day.weekday)} ${formatTimeRange(day.windowStart, day.windowEnd)}`,
  );
  return `Weekly delivery on scheduled route days: ${formatCountyList(parts)}.`;
}

export function serviceAreaSummary(settings: DeliverySettings) {
  const names = enabledCountyNames(settings);
  return `Select towns in select Chicagoland counties: ${formatCountyList(names)}. Coverage is town-by-town, not entire counties.`;
}

export function formatDeliverySlot(slot: DeliverySlot, timeZone = CHICAGO_TIME_ZONE) {
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(slot.windowStart);
  const start = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(slot.windowStart);
  const end = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(slot.windowEnd);
  return `${dateLabel}, ${start}–${end}`;
}

export function defaultDeliverySettings(): DeliverySettings {
  return {
    timezone: CHICAGO_TIME_ZONE,
    enabledCountyCodes: [...DEFAULT_ENABLED_COUNTY_CODES],
    days: WEEKDAYS.map((day) => ({
      weekday: day.weekday,
      enabled: day.weekday === 2 || day.weekday === 4,
      windowStart: "09:00",
      windowEnd: "15:00",
      cutoffHoursBefore: 12,
    })),
  };
}

export function parseDeliverySettings(value: unknown): DeliverySettings {
  if (!value || typeof value !== "object") {
    throw new DeliveryScheduleError("delivery settings must be an object");
  }
  const input = value as Record<string, unknown>;
  const timezone =
    typeof input.timezone === "string" && input.timezone.trim()
      ? input.timezone.trim()
      : CHICAGO_TIME_ZONE;

  const enabledCountyCodes = normalizeCountyCodes(input.enabledCountyCodes);
  const rawDays = Array.isArray(input.days) ? input.days : [];
  const daysByWeekday = new Map<Weekday, DeliveryDayConfig>();

  for (const raw of rawDays) {
    const day = parseDay(raw);
    daysByWeekday.set(day.weekday, day);
  }

  const defaults = defaultDeliverySettings();
  const days = WEEKDAYS.map((meta) => {
    const existing = daysByWeekday.get(meta.weekday);
    return existing ?? defaults.days[meta.weekday];
  });

  if (!days.some((day) => day.enabled)) {
    throw new DeliveryScheduleError("enable at least one weekly route day");
  }

  return { timezone, days, enabledCountyCodes };
}

export function normalizeDeliverySettings(value: unknown): DeliverySettings {
  try {
    return parseDeliverySettings(value);
  } catch {
    return defaultDeliverySettings();
  }
}

export function nextDeliverySlot(
  settings: DeliverySettings,
  now: Date,
): DeliverySlot | null {
  const timeZone = settings.timezone || CHICAGO_TIME_ZONE;
  const local = zonedParts(now, timeZone);

  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addLocalDays(local, offset);
    const day = settings.days.find(
      (entry) => entry.enabled && entry.weekday === candidate.weekday,
    );
    if (!day) continue;

    const startClock = parseClock(day.windowStart);
    const endClock = parseClock(day.windowEnd);
    if (!startClock || !endClock) continue;

    const windowStart = zonedTimeToUtc(
      timeZone,
      candidate.year,
      candidate.month,
      candidate.day,
      startClock.hour,
      startClock.minute,
    );
    const windowEnd = zonedTimeToUtc(
      timeZone,
      candidate.year,
      candidate.month,
      candidate.day,
      endClock.hour,
      endClock.minute,
    );
    const cutoffAt = new Date(
      windowStart.getTime() - Math.max(0, day.cutoffHoursBefore) * 60 * 60 * 1000,
    );
    if (now.getTime() < cutoffAt.getTime()) {
      return {
        weekday: day.weekday,
        weekdayName: weekdayName(day.weekday),
        windowStart,
        windowEnd,
        cutoffAt,
      };
    }
  }

  return null;
}

function parseDay(value: unknown): DeliveryDayConfig {
  if (!value || typeof value !== "object") {
    throw new DeliveryScheduleError("each route day must be an object");
  }
  const input = value as Record<string, unknown>;
  const weekday = Number(input.weekday);
  if (!WEEKDAYS.some((day) => day.weekday === weekday)) {
    throw new DeliveryScheduleError("weekday must be 0 (Sunday) through 6 (Saturday)");
  }
  const windowStart = normalizeClock(String(input.windowStart ?? "09:00"));
  const windowEnd = normalizeClock(String(input.windowEnd ?? "15:00"));
  if (!TIME_RE.test(windowStart) || !TIME_RE.test(windowEnd)) {
    throw new DeliveryScheduleError("window times must use HH:MM (24-hour)");
  }
  if (windowStart >= windowEnd) {
    throw new DeliveryScheduleError("window start must be before window end");
  }
  const cutoffHoursBefore = Number(input.cutoffHoursBefore ?? 0);
  if (
    !Number.isInteger(cutoffHoursBefore) ||
    cutoffHoursBefore < 0 ||
    cutoffHoursBefore > 72
  ) {
    throw new DeliveryScheduleError("cutoff hours must be an integer from 0 to 72");
  }
  return {
    weekday: weekday as Weekday,
    enabled: Boolean(input.enabled),
    windowStart,
    windowEnd,
    cutoffHoursBefore,
  };
}

function normalizeCountyCodes(value: unknown): CountyCode[] {
  const allowed = new Set<string>(CHICAGOLAND_COUNTIES.map((county) => county.code));
  const input = Array.isArray(value) ? value : DEFAULT_ENABLED_COUNTY_CODES;
  const unique: CountyCode[] = [];
  for (const item of input) {
    const code = String(item).trim().toLowerCase();
    if (!allowed.has(code)) continue;
    if (!unique.includes(code as CountyCode)) {
      unique.push(code as CountyCode);
    }
  }
  return unique;
}

function normalizeClock(value: string) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)/.exec(value.trim());
  if (!match) return value;
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function parseClock(value: string) {
  const match = TIME_RE.exec(normalizeClock(value));
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: Weekday;
};

function zonedParts(date: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  const weekdayMap: Record<string, Weekday> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday] ?? 0,
  };
}

function addLocalDays(parts: LocalParts, days: number): LocalParts {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    weekday: utc.getUTCDay() as Weekday,
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
  );
  return asUtc - date.getTime();
}

function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = timeZoneOffsetMs(utcGuess, timeZone);
  const adjusted = new Date(utcGuess.getTime() - offset);
  const offsetAgain = timeZoneOffsetMs(adjusted, timeZone);
  if (offsetAgain !== offset) {
    return new Date(utcGuess.getTime() - offsetAgain);
  }
  return adjusted;
}
