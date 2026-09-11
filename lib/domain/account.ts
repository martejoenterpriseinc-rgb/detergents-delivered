import { z } from "zod";

export const profileSchema = z
  .object({
    firstName: z.string().trim().min(1, "Enter your first name.").max(80),
    lastName: z.string().trim().max(80),
    phone: z
      .string()
      .trim()
      .max(30)
      .refine((v) => !v || /^\+?[\d ()-]{7,30}$/.test(v), "Enter a valid phone number."),
  })
  .strict();
export const notificationSchema = z
  .object({ emailNotifications: z.boolean(), smsNotifications: z.boolean().optional() })
  .strict();
export const passwordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z
      .string()
      .min(12, "Use at least 12 characters.")
      .refine(
        (v) => new TextEncoder().encode(v).length <= 72,
        "Password must be at most 72 bytes.",
      ),
    confirmPassword: z.string(),
  })
  .strict()
  .refine(
    (v) => v.newPassword === v.confirmPassword,
    "Password confirmation does not match.",
  )
  .refine((v) => v.newPassword !== v.currentPassword, "Choose a different password.");
export const SUPPORT_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
] as const;
export const SUPPORT_LABELS = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  WAITING_CUSTOMER: "Waiting for customer",
  RESOLVED: "Resolved",
};
export const SUPPORT_CATEGORIES = [
  "Delivery",
  "Missing item",
  "Damaged item",
  "Wrong item",
  "Payment",
  "Address change",
  "Account",
  "Other",
] as const;
export const ticketSchema = z
  .object({
    orderId: z.string().min(1).max(100).nullable(),
    category: z.enum(SUPPORT_CATEGORIES),
    subject: z.string().trim().min(3).max(160),
    message: z.string().trim().min(5).max(4000),
    requestKey: z.uuid(),
  })
  .strict();
export const replySchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    status: z.enum(SUPPORT_STATUSES).optional(),
    version: z.number().int().nonnegative(),
    requestKey: z.uuid(),
  })
  .strict();
export const supportFilterSchema = z.object({
  status: z.enum(["ALL", "ACTIVE", ...SUPPORT_STATUSES]).default("ACTIVE"),
  q: z.string().trim().max(100).default(""),
  sort: z.enum(["updated", "oldest", "newest"]).default("updated"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export class AccountError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const ORDER_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  FULFILLING: "Preparing your order",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivery completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  return (
    '"' + (/^[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'
  );
}
