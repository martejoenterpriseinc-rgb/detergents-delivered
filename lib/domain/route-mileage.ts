import { z } from "zod";
export const odometer = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/,
    "Use miles with at most two decimal places.",
  );
export function hundredths(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export const routeMileageInput = z
  .object({
    routeId: z.string().min(1).max(100),
    requestKey: z.uuid(),
    version: z.number().int().min(0).max(1000000),
    reason: z.string().trim().max(500).default(""),
    legs: z
      .array(
        z
          .object({
            sequence: z.number().int().min(0).max(10000),
            start: odometer.nullable(),
            end: odometer.nullable(),
            planned: odometer.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(101),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (v.version && !v.reason) fail("Explain why you are updating the saved mileage.");
    if (new Set(v.legs.map((l) => l.sequence)).size !== v.legs.length)
      fail("Each route leg must appear exactly once.");
    let unknown = false,
      lastEnd: number | null = null;
    for (const l of [...v.legs].sort((a, b) => a.sequence - b.sequence)) {
      if (l.planned !== null && hundredths(l.planned) > 1000000)
        fail("A planned leg must not exceed 10,000 miles.");
      if ((l.start === null) !== (l.end === null))
        fail("Enter both odometer readings or leave both blank.");
      if (l.start === null || l.end === null) {
        unknown = true;
        continue;
      }
      const start = hundredths(l.start),
        end = hundredths(l.end);
      if (unknown) fail("Record actual mileage in route order.");
      if (end < start || end - start > 1000000)
        fail("A leg must be between zero and 10,000 miles.");
      if (lastEnd !== null && start !== lastEnd)
        fail("Each leg must start at the previous leg's ending odometer.");
      lastEnd = end;
    }
  });
