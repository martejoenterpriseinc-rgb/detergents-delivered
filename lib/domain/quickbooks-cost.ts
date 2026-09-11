import { z } from "zod";
export const costPiece = z
  .object({
    allocationId: z.string(),
    costLayerId: z.string(),
    quantity: z.number().int().positive(),
    unitCostCents: z.number().int().nonnegative(),
  })
  .strict();
export function recordedCost(pieces: unknown) {
  const rows = z.array(costPiece).min(1).max(500).parse(pieces);
  const total = rows.reduce((sum, row) => sum + row.quantity * row.unitCostCents, 0);
  if (!Number.isSafeInteger(total) || total > 100000000)
    throw new Error("Recorded cost exceeds the supported journal limit.");
  return total;
}
export const costMappingSchema = z
  .object({
    version: z.number().int().positive(),
    mode: z.enum(["sandbox", "live"]),
    realm: z.string(),
    costAccount: z.object({
      id: z.string(),
      name: z.string(),
      type: z.literal("Cost of Goods Sold"),
      currency: z.literal("USD"),
    }),
    inventoryAccount: z.object({
      id: z.string(),
      name: z.string(),
      type: z.literal("Other Current Asset"),
      currency: z.literal("USD"),
    }),
    verifiedAt: z.string().datetime(),
  })
  .strict();
