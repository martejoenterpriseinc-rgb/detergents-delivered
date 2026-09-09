import { z } from "zod";
export const programSchema = z
  .object({
    enabled: z.boolean(),
    referrerRewardCents: z.number().int().min(0).max(100000),
    friendRewardCents: z.number().int().min(0).max(100000),
    minimumPurchaseCents: z.number().int().min(0).max(1000000),
    linkExpiryDays: z.number().int().min(1).max(365),
    maxReferralsPerCustomer: z.number().int().min(1).max(500),
    version: z.number().int().min(0),
  })
  .strict();
export const loyaltyActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      label: z.string().trim().min(1).max(60),
      requestKey: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("shared"),
      id: z.string().min(1).max(100),
      method: z.enum(["COPY", "SHARE"]),
    })
    .strict(),
  z
    .object({ action: z.literal("claim"), token: z.string().regex(/^[a-f0-9]{48}$/) })
    .strict(),
]);
export const rewardQuoteSchema = z
  .object({
    promotionCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/)
      .optional(),
    applyRewards: z.boolean().default(true),
    lines: z
      .array(
        z
          .object({
            variantId: z.string().min(1).max(100),
            quantity: z.number().int().min(1).max(24),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export function rewardAllocation(availableCents: number, dueCents: number) {
  if (![availableCents, dueCents].every((v) => Number.isSafeInteger(v) && v >= 0))
    throw new Error("Invalid reward amounts");
  const appliedCents = Math.min(availableCents, dueCents);
  return {
    appliedCents,
    remainingCents: availableCents - appliedCents,
    payableCents: dueCents - appliedCents,
  };
}
export function dollarsToCents(value: string) {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter a dollar amount with up to two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export const defaultProgram = {
  id: "default",
  enabled: false,
  referrerRewardCents: 0,
  friendRewardCents: 0,
  minimumPurchaseCents: 0,
  linkExpiryDays: 30,
  maxReferralsPerCustomer: 25,
  version: 0,
};
export const deliveryStates = {
  DRAFT: { label: "No delivery booked", color: "bg-slate-400" },
  PENDING_PAYMENT: { label: "Awaiting payment", color: "bg-amber-500" },
  PAID: { label: "Payment received", color: "bg-amber-500" },
  FULFILLING: { label: "Preparing your delivery", color: "bg-amber-500" },
  TODAY: { label: "Your items will be delivered today", color: "bg-teal-500" },
  EN_ROUTE: { label: "Driver en route", color: "bg-blue-500" },
  ARRIVED: { label: "Driver has arrived", color: "bg-amber-500" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", color: "bg-blue-500" },
  DELIVERED: { label: "Delivery completed", color: "bg-emerald-500" },
  CANCELLED: { label: "Order cancelled", color: "bg-rose-500" },
  REFUNDED: { label: "Order refunded", color: "bg-slate-400" },
  NONE: { label: "No delivery scheduled", color: "bg-slate-400" },
} as const;
export type DeliverySnapshot = {
  status: keyof typeof deliveryStates;
  orderNumber: string | null;
  plannedArrival: string | null;
  source: "Saved order and route schedule";
  checkedAt: string;
};
