import { z } from "zod";
export const smsTimezones = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;
export const smsConsentVersion = "delivery-texts-v1";
export const smsConsentInput = z
  .object({ confirmed: z.literal(true), timezone: z.enum(smsTimezones) })
  .strict();
export function smsPhone(value: string) {
  const phone = value.replace(/[ ()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
export const smsStopWords = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
]);
export function smsDeliveryHour(timezone: string, now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= 8 && hour < 20;
}
