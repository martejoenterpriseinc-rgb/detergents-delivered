import { z } from "zod";

const reviewed = new Set([
  "20260915100000_refund_return_lifecycle",
  "20260915101000_return_cost_evidence",
]);

/** This release may apply only its two reviewed additive migrations. */
export function refundMigrationAction(raw: unknown): "current" | "migrate" {
  const inspection = z
    .object({
      status: z.enum(["current", "pending"]),
      tableCount: z.number().int().positive(),
      completedMigrations: z.number().int().positive(),
      pendingMigrations: z.array(z.string()),
      problems: z.array(z.string()).length(0),
    })
    .parse(raw);
  if (inspection.status === "current" && !inspection.pendingMigrations.length)
    return "current";
  if (
    inspection.status === "pending" &&
    inspection.pendingMigrations.length &&
    inspection.pendingMigrations.every((name) => reviewed.has(name))
  )
    return "migrate";
  throw new Error("Only the reviewed refund foundation migrations may be applied.");
}
