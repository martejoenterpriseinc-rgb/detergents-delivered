import { z } from "zod";
import { dateSchema, businessDate } from "@/lib/domain/operations";

// At 06:00 UTC, Chicago is midnight (standard time) or 01:00 (daylight time).
// Resolve each boundary separately so spring/fall transition days keep their full range.
export function financeDayStart(date: string) {
  const six = new Date(date + "T06:00:00Z");
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(six);
  return new Date(six.getTime() - (Number(hour) === 1 ? 3600000 : 0));
}

export const financeKind = z.enum(["expense", "mileage"]);
const base = {
  requestKey: z.uuid(),
  id: z.string().min(1).max(100).optional(),
  version: z.number().int().min(0).max(1000000),
  date: dateSchema.refine(
    (value) => value <= businessDate(),
    "Choose today or an earlier date.",
  ),
  reason: z.string().trim().max(500).default(""),
};
export const financeInput = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...base,
        kind: z.literal("expense"),
        category: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .transform((v) => v.replace(/\s+/g, " ").toLowerCase()),
        amount: z
          .string()
          .regex(
            /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/,
            "Enter a USD amount with no more than two decimals.",
          )
          .transform((value) => {
            const [whole, fraction = ""] = value.split(".");
            return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
          })
          .refine(
            (value) => value > 0 && value <= 100000000,
            "Amount must be between $0.01 and $1,000,000.",
          ),
        memo: z.string().trim().min(1).max(1000),
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal("mileage"),
        vehicleId: z.string().min(1).max(100),
        startOdometer: z.number().int().min(0).max(10000000),
        endOdometer: z.number().int().min(1).max(10000000),
        purpose: z.string().trim().min(1).max(1000),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.id && !value.reason)
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Explain the correction.",
      });
    if (!value.id && value.version !== 0)
      ctx.addIssue({
        code: "custom",
        path: ["version"],
        message: "New records start at version zero.",
      });
    if (
      value.kind === "mileage" &&
      (value.endOdometer <= value.startOdometer ||
        value.endOdometer - value.startOdometer > 10000)
    )
      ctx.addIssue({
        code: "custom",
        path: ["endOdometer"],
        message: "Ending odometer must exceed the start by no more than 10,000 miles.",
      });
  });
export function financeFilters(input: unknown) {
  const today = businessDate();
  return z
    .object({
      from: dateSchema.default(today.slice(0, 7) + "-01"),
      to: dateSchema.default(today),
      page: z.coerce.number().int().min(1).max(100000).default(1),
    })
    .strict()
    .refine((v) => v.from <= v.to, "Start date must be before the end date.")
    .refine(
      (v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 366 * 86400000,
      "Choose a range of up to one year.",
    )
    .parse(input);
}
