import { z } from "zod";
export const checkoutInput = z
  .object({
    requestKey: z.string().uuid(),
    addressId: z.string().min(1).max(100),
    lines: z
      .array(
        z
          .object({
            variantId: z.string().min(1).max(100),
            quantity: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    promotionCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/)
      .optional(),
    useRewards: z.boolean(),
  })
  .strict()
  .refine(
    (v) => new Set(v.lines.map((l) => l.variantId)).size === v.lines.length,
    "Each product must appear once.",
  );
export type CheckoutInput = z.infer<typeof checkoutInput>;
export type CheckoutLine = {
  variantId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  netCents: number;
  taxCode: string;
  spaceUnits: number;
  loadKind: string;
};
export type CheckoutSnapshot = {
  input: CheckoutInput;
  email: string;
  name: string;
  address: {
    id: string;
    version: string;
    line1: string;
    line2: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
    lat: number;
    lng: number;
  };
  zoneId: string;
  launchVersion: number;
  launchDate: string;
  firstDeliveryBy: string;
  vehicleId: string;
  dates: string[];
  lines: CheckoutLine[];
  subtotalCents: number;
  promotionCents: number;
  rewardsCents: number;
  promotion: { id: string; version: number; audience: string } | null;
  taxCents: number;
  totalCents: number;
  taxCalculationId: string;
  taxBreakdown: unknown;
};
/** Largest remainder allocation: every cent allocated once, without floating point drift. */
export function allocateCents(amount: number, weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > total ||
    weights.some((w) => !Number.isSafeInteger(w) || w < 0) ||
    total > 100000000
  )
    throw new Error("Invalid discount allocation.");
  if (!total) return weights.map(() => 0);
  const rows = weights.map((w, i) => ({
    i,
    value: Number((BigInt(w) * BigInt(amount)) / BigInt(total)),
    remainder: (BigInt(w) * BigInt(amount)) % BigInt(total),
  }));
  let left = amount - rows.reduce((a, r) => a + r.value, 0);
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (left-- <= 0) break;
    row.value++;
  }
  return rows.map((r) => r.value);
}
export const heldStates = ["PREPARING", "OPEN", "PROCESSING", "REVIEW"];
export const capacityStates = [...heldStates, "PAID"];
