import { z } from "zod";
export const subscriptionConsentVersion = "quarterly-pay-at-purchase-v1";
export const subscriptionConsent =
  "Repeat these products every three calendar months. I will review current prices, tax, stock and delivery availability and pay for each purchase. This does not authorize automatic charges. I can pause, skip or cancel future orders.";
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Choose a valid date.");
export function quarterDate(anchor: string, cycle: number) {
  calendarDate.parse(anchor);
  z.number().int().min(1).max(400).parse(cycle);
  const [year, month, day] = anchor.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + 3 * cycle, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last)),
  )
    .toISOString()
    .slice(0, 10);
}
export function upcomingQuarter(anchor: string, minimumCycle: number, today: string) {
  calendarDate.parse(today);
  let cycle = minimumCycle;
  while (quarterDate(anchor, cycle) <= today) cycle++;
  return { cycle, date: quarterDate(anchor, cycle) };
}
const id = z.string().min(1).max(100);
export const subscriptionCreateInput = z
  .object({
    requestKey: z.string().uuid(),
    originOrderId: id,
    accepted: z.literal(true),
    consentVersion: z.literal(subscriptionConsentVersion),
  })
  .strict();
export const subscriptionChangeInput = z
  .object({
    requestKey: z.string().uuid(),
    id,
    version: z.number().int().nonnegative(),
    action: z.enum(["pause", "resume", "skip", "cancel"]),
  })
  .strict();

export const subscriptionCycleInput = z.object({ subscriptionId: id }).strict();
