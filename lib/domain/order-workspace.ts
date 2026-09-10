import { OrderStatus } from "@prisma/client";
import { z } from "zod";
import { dateSchema } from "@/lib/domain/operations";

const optionalDate = z
  .union([dateSchema, z.literal("")])
  .optional()
  .transform((v) => v || undefined);
export const orderFilters = z
  .object({
    q: z.string().trim().max(100).default(""),
    status: z.union([z.nativeEnum(OrderStatus), z.literal("ALL")]).default("ALL"),
    view: z.enum(["all", "review"]).default("all"),
    from: optionalDate,
    to: optionalDate,
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict()
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "The end date must follow the start date.",
  );
export const orderId = z.string().min(1).max(100);
export const orderStatusLabels: Record<OrderStatus, string> = {
  DRAFT: "Draft",
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  FULFILLING: "Fulfilling",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};
export function orderMoney(cents: number, currency: string) {
  return `${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
