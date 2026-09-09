import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import {
  businessDate,
  customerEditSchema,
  customerFilters,
  dateSchema,
  inviteSchema,
  monthStart,
  type CustomerRow,
  type QueueData,
  type StopRow,
} from "@/lib/domain/operations";
import { accountIdentity } from "./customer-account";
import { proofStorageReady } from "./proof-storage";

export async function operationsStaff(
  db: Prisma.TransactionClient,
  userId: string,
  driver = false,
) {
  const user = await accountIdentity(db, userId);
  const roles = user.userRoles.map((r) => r.role.code);
  if (
    !roles.some((r) =>
      ["ADMIN", "SUPER_ADMIN", ...(driver ? ["DRIVER"] : [])].includes(r),
    )
  )
    throw new AccountError("Operations access is not allowed.", 403);
  return { user, isAdmin: roles.some((r) => ["ADMIN", "SUPER_ADMIN"].includes(r)) };
}
export const paidStatuses = [
  "PAID",
  "FULFILLING",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;
export const countedRevenue = (o: {
  totalCents: number;
  refunds: { amountCents: number }[];
}) => o.totalCents - o.refunds.reduce((n, r) => n + r.amountCents, 0);
const customerName = (c: {
  firstName: string | null;
  lastName: string | null;
  user: { name: string | null; email: string };
}) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.user.name || c.user.email;
export async function customerDirectory(userId: string, input: unknown = {}) {
  await operationsStaff(prisma, userId);
  const filter = customerFilters.parse(input);
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, user: { deletedAt: null } },
    take: 5001,
    include: {
      user: { select: { name: true, email: true } },
      addresses: {
        where: { deletedAt: null },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        take: 1,
      },
      orders: {
        where: { currency: "USD", status: { in: [...paidStatuses] } },
        select: { totalCents: true, refunds: { select: { amountCents: true } } },
      },
      referredBy: {
        include: {
          referrer: { include: { user: { select: { name: true, email: true } } } },
        },
      },
    },
  });
  if (customers.length > 5000)
    throw new AccountError(
      "This directory exceeds the current 5,000-customer map limit. Contact support for a paginated map upgrade.",
      422,
    );
  const all: CustomerRow[] = customers.map((c) => {
    const a = c.addresses[0];
    return {
      id: c.id,
      name: customerName(c),
      email: c.user.email,
      phone: c.phone ?? "",
      firstName: c.firstName ?? "",
      lastName: c.lastName ?? "",
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      city: a?.city ?? "",
      address: a
        ? [a.line1, a.line2, a.city, a.region, a.postalCode].filter(Boolean).join(", ")
        : "Address not saved",
      lat: a?.lat ?? null,
      lng: a?.lng ?? null,
      totalOrders: c.orders.length,
      revenueCents: c.orders.reduce((n, o) => n + countedRevenue(o), 0),
      referrer: c.referredBy ? customerName(c.referredBy.referrer) : null,
    };
  });
  const matches = all.filter(
    (c) =>
      (filter.group !== "referred" || c.referrer) &&
      (filter.group !== "new" ||
        (businessDate(new Date(c.createdAt)) >= monthStart(filter.date) &&
          businessDate(new Date(c.createdAt)) <= filter.date)) &&
      (!filter.city || c.city === filter.city) &&
      (!filter.q ||
        [c.name, c.email, c.phone, c.address, c.referrer]
          .join(" ")
          .toLowerCase()
          .includes(filter.q.toLowerCase())),
  );
  matches.sort(
    (a, b) =>
      (filter.sort === "name"
        ? a.name.localeCompare(b.name)
        : filter.sort === "orders"
          ? b.totalOrders - a.totalOrders
          : filter.sort === "revenue"
            ? b.revenueCents - a.revenueCents
            : filter.sort === "oldest"
              ? a.createdAt.localeCompare(b.createdAt)
              : b.createdAt.localeCompare(a.createdAt)) || a.id.localeCompare(b.id),
  );
  return {
    filter,
    total: all.length,
    referred: all.filter((c) => c.referrer).length,
    newCustomers: all.filter(
      (c) =>
        businessDate(new Date(c.createdAt)) >= monthStart(filter.date) &&
        businessDate(new Date(c.createdAt)) <= filter.date,
    ).length,
    cities: [...new Set(all.map((c) => c.city).filter(Boolean))].sort(),
    matching: matches.length,
    pins: matches.map(({ id, name, lat, lng, city, referrer }) => ({
      id,
      name,
      lat,
      lng,
      city,
      referrer,
    })),
    rows: matches.slice((filter.page - 1) * 25, filter.page * 25),
  };
}
export async function dailyQueue(
  userId: string,
  date = businessDate(),
): Promise<QueueData> {
  dateSchema.parse(date);
  const { isAdmin } = await operationsStaff(prisma, userId, true);
  const routes = await prisma.route.findMany({
    where: {
      serviceDate: new Date(date),
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...(!isAdmin ? { stops: { some: { driverUserId: userId } } } : {}),
    },
    orderBy: [{ number: "asc" }, { id: "asc" }],
    include: {
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          address: {
            include: {
              customer: { include: { user: { select: { name: true, email: true } } } },
            },
          },
          order: { include: { items: true, refunds: true } },
          deliveryAttempts: {
            where: { result: "DELIVERED" },
            orderBy: { attemptedAt: "desc" },
            take: 1,
            include: { photos: true },
          },
        },
      },
    },
  });
  const visible = routes.flatMap((r) =>
    r.stops.filter((s) => isAdmin || s.driverUserId === userId).map((s) => ({ r, s })),
  );
  if (visible.length > 500)
    throw new AccountError(
      "Choose a smaller route set; a day supports up to 500 mapped stops.",
      422,
    );
  const stops: StopRow[] = visible.map(({ r, s }) => {
    const o = s.order;
    const eligible =
      o &&
      o.currency === "USD" &&
      paidStatuses.includes(o.status as (typeof paidStatuses)[number]) &&
      o.customerId === s.address.customerId &&
      o.addressId === s.addressId;
    return {
      id: s.id,
      routeId: r.id,
      routeNumber: r.number,
      sequence: s.sequence,
      customerId: s.address.customerId,
      customer: customerName(s.address.customer),
      address: [
        s.address.line1,
        s.address.line2,
        s.address.city,
        s.address.region,
        s.address.postalCode,
      ]
        .filter(Boolean)
        .join(", "),
      city: s.address.city,
      lat: s.address.lat,
      lng: s.address.lng,
      orderId: s.orderId,
      orderNumber: o?.number ?? "No order",
      items: o?.items.map((i) => `${i.quantity} × ${i.nameSnapshot}`).join(" · ") ?? "",
      revenueCents: isAdmin && eligible ? countedRevenue(o!) : 0,
      status: s.completedAt
        ? "COMPLETED"
        : !eligible
          ? "BLOCKED"
          : s.arrivedAt
            ? "ARRIVED"
            : s.startedAt
              ? "EN_ROUTE"
              : r.status === "IN_PROGRESS"
                ? "TODAY"
                : "SCHEDULED",
      eta: s.plannedArriveAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      photoId: s.deliveryAttempts[0]?.photos[0]?.id ?? null,
      assignedTo: s.driverUserId,
    };
  });
  const counted = new Set<string>();
  let revenueCents = 0;
  for (const s of stops)
    if (s.orderId && !counted.has(s.orderId)) {
      counted.add(s.orderId);
      revenueCents += s.revenueCents;
    }
  return {
    canManage: isAdmin,
    date,
    checkedAt: new Date().toISOString(),
    stops,
    routeIds: routes.map((r) => r.id),
    total: stops.length,
    completed: stops.filter((s) => s.status === "COMPLETED").length,
    revenueCents,
    plannedMiles:
      routes.length && routes.every((r) => r.plannedMiles !== null)
        ? routes.reduce((n, r) => n + Number(r.plannedMiles), 0).toFixed(1)
        : null,
    actualMiles:
      routes.length && routes.every((r) => r.actualMiles !== null)
        ? routes.reduce((n, r) => n + Number(r.actualMiles), 0).toFixed(1)
        : null,
    proofReady: proofStorageReady(),
  };
}
export async function revenueOrders(
  userId: string,
  date = businessDate(),
  period: "day" | "mtd" = "mtd",
) {
  await operationsStaff(prisma, userId);
  dateSchema.parse(date);
  // Include a UTC margin; final calendar filtering is America/Chicago, including DST.
  const start = period === "mtd" ? monthStart(date) : date;
  const rows = await prisma.order.findMany({
    where: {
      status: { in: [...paidStatuses] },
      currency: "USD",
      placedAt: {
        gte: new Date(start),
        lt: new Date(new Date(date).getTime() + 2 * 86400000),
      },
    },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      refunds: true,
    },
    orderBy: { placedAt: "desc" },
    take: 5001,
  });
  if (rows.length > 5000)
    throw new AccountError("This report exceeds 5,000 orders; narrow the period.", 422);
  return rows
    .filter(
      (o) =>
        o.placedAt &&
        businessDate(o.placedAt) >= start &&
        businessDate(o.placedAt) <= date,
    )
    .map((o) => ({
      id: o.id,
      number: o.number,
      customer: customerName(o.customer),
      placedAt: o.placedAt!.toISOString(),
      status: o.status,
      revenueCents: countedRevenue(o),
    }));
}
export async function editOperationsCustomer(userId: string, input: unknown) {
  const d = customerEditSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await operationsStaff(tx, userId);
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${d.id} FOR UPDATE`;
    const c = await tx.customer.findFirst({
      where: { id: d.id, deletedAt: null, user: { deletedAt: null } },
    });
    if (!c) throw new AccountError("Customer not found.", 404);
    if (c.updatedAt.toISOString() !== d.updatedAt)
      throw new AccountError("Customer changed. Refresh before saving.", 409);
    if (!d.phone && c.smsNotifications)
      throw new AccountError(
        "The customer must disable SMS before removing their phone.",
      );
    await tx.customer.update({
      where: { id: c.id },
      data: { firstName: d.firstName, lastName: d.lastName, phone: d.phone || null },
    });
    await tx.user.update({
      where: { id: c.userId },
      data: { name: [d.firstName, d.lastName].filter(Boolean).join(" ") },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "customer.staff.updated",
        entityType: "Customer",
        entityId: c.id,
        beforeJson: { firstName: c.firstName, lastName: c.lastName, phone: c.phone },
        afterJson: { firstName: d.firstName, lastName: d.lastName, phone: d.phone },
      },
    });
    return { ok: true };
  });
}
export async function createCustomerInvite(userId: string, input: unknown) {
  const d = inviteSchema.parse(input);
  const hash = createHash("sha256").update(JSON.stringify(d)).digest("hex");
  return prisma.$transaction(async (tx) => {
    await operationsStaff(tx, userId);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const old = await tx.customerInvite.findUnique({
      where: { requestKey: d.requestKey },
    });
    if (old) {
      if (old.requestHash !== hash || old.createdByUserId !== userId)
        throw new AccountError("Request already used.", 409);
      return { id: old.id, token: old.token, status: old.status };
    }
    if (await tx.user.findUnique({ where: { email: d.email } }))
      throw new AccountError(
        "This customer already has an account. Use the customer directory.",
        409,
      );
    if (
      (await tx.customerInvite.count({
        where: {
          createdByUserId: userId,
          createdAt: { gte: new Date(Date.now() - 3600000) },
        },
      })) >= 25
    )
      throw new AccountError("Invite limit reached. Try again later.", 429);
    const invite = await tx.customerInvite.create({
      data: {
        ...d,
        requestHash: hash,
        token: randomBytes(24).toString("hex"),
        createdByUserId: userId,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "customer.invite.created",
        entityType: "CustomerInvite",
        entityId: invite.id,
        afterJson: { status: "CREATED" },
      },
    });
    return { id: invite.id, token: invite.token, status: invite.status };
  });
}
