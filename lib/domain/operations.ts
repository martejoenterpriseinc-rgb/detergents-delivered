import { z } from "zod";

export const BUSINESS_ZONE = "America/Chicago";
export function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Choose a valid date.",
  );
export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}
export const customerFilters = z.object({
  q: z.string().trim().max(100).default(""),
  group: z.enum(["all", "new", "referred"]).default("all"),
  sort: z.enum(["newest", "oldest", "name", "orders", "revenue"]).default("newest"),
  city: z.string().max(100).default(""),
  date: dateSchema.default(() => businessDate()),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  updatedAt: string;
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
  totalOrders: number;
  revenueCents: number;
  referrer: string | null;
};
export type StopRow = {
  id: string;
  routeId: string;
  routeNumber: string;
  sequence: number;
  customerId: string;
  customer: string;
  address: string;
  city: string;
  lat: number | null;
  lng: number | null;
  orderId: string | null;
  orderNumber: string;
  items: string;
  revenueCents: number;
  status: "SCHEDULED" | "TODAY" | "EN_ROUTE" | "ARRIVED" | "COMPLETED" | "BLOCKED";
  eta: string | null;
  completedAt: string | null;
  photoId: string | null;
  assignedTo: string | null;
};
export type QueueData = {
  canManage: boolean;
  date: string;
  checkedAt: string;
  stops: StopRow[];
  routeIds: string[];
  total: number;
  completed: number;
  revenueCents: number;
  plannedMiles: string | null;
  actualMiles: string | null;
  proofReady: boolean;
};
export const stopLabels: Record<StopRow["status"], string> = {
  SCHEDULED: "Scheduled",
  TODAY: "Delivering today",
  EN_ROUTE: "Driver en route",
  ARRIVED: "Arrived",
  COMPLETED: "Completed",
  BLOCKED: "Needs review",
};
export function validPoint(lat: number | null, lng: number | null) {
  return (
    lat !== null &&
    lng !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 85 &&
    Math.abs(lng) <= 180
  );
}
export function wazeUrl(lat: number | null, lng: number | null) {
  if (!validPoint(lat, lng)) return null;
  return `https://waze.com/ul?ll=${lat}%2C${lng}&navigate=yes&utm_source=detergentsdelivered`;
}
export const customerEditSchema = z
  .object({
    id: z.string().min(1).max(100),
    updatedAt: z.iso.datetime(),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80),
    phone: z
      .string()
      .trim()
      .max(30)
      .refine((v) => !v || /^\+?[\d ()-]{7,30}$/.test(v), "Enter a valid phone number."),
  })
  .strict();
export const deliveryActionSchema = z
  .object({
    action: z.enum(["begin", "navigate", "arrive"]),
    routeId: z.string().min(1).max(100),
    stopId: z.string().max(100).optional(),
    requestKey: z.uuid(),
  })
  .strict();
export const inviteSchema = z
  .object({
    email: z.email().transform((v) => v.toLowerCase()),
    firstName: z.string().trim().min(1).max(80),
    requestKey: z.uuid(),
  })
  .strict();
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
