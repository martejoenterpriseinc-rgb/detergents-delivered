import { z } from "zod";
import { dateSchema } from "./operations";
export const promotionSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/),
    name: z.string().trim().min(1).max(120),
    valueType: z.enum(["FIXED", "PERCENT"]),
    value: z.number().int().min(1).max(1000000),
    startsOn: dateSchema,
    endsOn: dateSchema,
    minimumPurchaseCents: z.number().int().min(0).max(1000000),
    maximumDiscountCents: z.number().int().min(1).max(1000000).nullable(),
    audience: z.enum(["ALL", "FIRST_ORDER", "REFERRED"]),
    allowRewards: z.boolean(),
    isActive: z.boolean(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.endsOn < v.startsOn)
      ctx.addIssue({ code: "custom", message: "End date must follow start date." });
    if (v.valueType === "PERCENT" && v.value > 10000)
      ctx.addIssue({ code: "custom", message: "Percent cannot exceed 100%." });
  });
export type PromotionTerms = z.infer<typeof promotionSchema>;
export function discountForPromotion(
  p: PromotionTerms,
  subtotalCents: number,
  date: string,
  facts: { hasPriorOrder: boolean; referred: boolean },
) {
  promotionSchema.parse(p);
  if (
    !Number.isSafeInteger(subtotalCents) ||
    subtotalCents < 0 ||
    subtotalCents > 100000000
  )
    throw new Error("Invalid merchandise amount.");
  if (!p.isActive || date < p.startsOn || date > p.endsOn)
    throw new Error("This promotion is not active for this date.");
  if (subtotalCents < p.minimumPurchaseCents)
    throw new Error("The cart does not meet this promotion's minimum purchase.");
  if (
    (p.audience === "FIRST_ORDER" && facts.hasPriorOrder) ||
    (p.audience === "REFERRED" && !facts.referred)
  )
    throw new Error("This account is not eligible for this promotion.");
  // Half-up rounding, integer cents; bounded operands stay in the safe integer range.
  const raw =
    p.valueType === "FIXED"
      ? p.value
      : Math.floor((subtotalCents * p.value + 5000) / 10000);
  return Math.min(subtotalCents, raw, p.maximumDiscountCents ?? subtotalCents);
}
