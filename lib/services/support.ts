import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountIdentity, customerIdentity } from "./customer-account";
import {
  AccountError,
  ticketSchema,
  replySchema,
  supportFilterSchema,
} from "@/lib/domain/account";

export async function requireSupportStaff(db: Prisma.TransactionClient, userId: string) {
  const user = await accountIdentity(db, userId);
  if (!user.userRoles.some((r) => ["ADMIN", "SUPER_ADMIN"].includes(r.role.code)))
    throw new AccountError("Support access is not allowed.", 403);
  return user;
}
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ticketSelect = {
  id: true,
  orderId: true,
  subject: true,
  category: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  order: { select: { number: true } },
} satisfies Prisma.SupportTicketSelect;
export async function createSupportTicket(userId: string, input: unknown) {
  const data = ticketSchema.parse(input);
  const requestHash = fingerprint(data);
  return prisma.$transaction(async (tx) => {
    const { customer } = await customerIdentity(tx, userId, true);
    const existing = await tx.supportTicket.findUnique({
      where: {
        customerId_requestKey: { customerId: customer.id, requestKey: data.requestKey },
      },
    });
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new AccountError(
          "This request was already used for a different problem.",
          409,
        );
      return { id: existing.id };
    }
    if (
      data.orderId &&
      !(await tx.order.findFirst({
        where: { id: data.orderId, customerId: customer.id },
        select: { id: true },
      }))
    )
      throw new AccountError("Order not found.", 404);
    if (
      (await tx.supportTicket.count({
        where: {
          customerId: customer.id,
          createdAt: { gt: new Date(Date.now() - 3600000) },
        },
      })) >= 5
    )
      throw new AccountError(
        "Please reply to an existing ticket or try again later.",
        429,
      );
    const ticket = await tx.supportTicket.create({
      data: {
        customerId: customer.id,
        orderId: data.orderId,
        subject: data.subject,
        category: data.category,
        requestKey: data.requestKey,
        requestHash,
        messages: {
          create: {
            authorUserId: userId,
            isStaff: false,
            body: data.message,
            requestKey: data.requestKey,
            requestHash,
          },
        },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "support.ticket.created",
        entityType: "SupportTicket",
        entityId: ticket.id,
        afterJson: { status: "OPEN", orderId: data.orderId, category: data.category },
      },
    });
    return { id: ticket.id };
  });
}
export function supportWhere(
  filters: ReturnType<typeof supportFilterSchema.parse>,
): Prisma.SupportTicketWhereInput {
  return {
    ...(filters.status === "ALL"
      ? {}
      : { status: filters.status === "ACTIVE" ? { not: "RESOLVED" } : filters.status }),
    ...(filters.q
      ? {
          OR: [
            { id: { contains: filters.q, mode: "insensitive" } },
            { subject: { contains: filters.q, mode: "insensitive" } },
            { order: { number: { contains: filters.q, mode: "insensitive" } } },
            {
              customer: { user: { email: { contains: filters.q, mode: "insensitive" } } },
            },
          ],
        }
      : {}),
  };
}
export async function listSupportTickets(
  userId: string,
  input: unknown,
  staff = false,
  exportAll = false,
) {
  if (staff) await requireSupportStaff(prisma, userId);
  const filters = supportFilterSchema.parse(input);
  const customer = staff ? null : (await customerIdentity(prisma, userId)).customer;
  const where = {
    ...supportWhere(filters),
    ...(customer ? { customerId: customer.id } : {}),
  };
  const total = await prisma.supportTicket.count({ where });
  if (exportAll && total > 10000)
    throw new AccountError(
      "Narrow your filters to 10,000 tickets or fewer before exporting.",
    );
  const tickets = await prisma.supportTicket.findMany({
    where,
    select: {
      ...ticketSelect,
      ...(staff
        ? {
            customer: {
              select: {
                firstName: true,
                lastName: true,
                user: { select: { email: true } },
              },
            },
          }
        : {}),
    },
    orderBy:
      filters.sort === "oldest"
        ? [{ createdAt: "asc" }, { id: "asc" }]
        : filters.sort === "newest"
          ? [{ createdAt: "desc" }, { id: "desc" }]
          : [{ updatedAt: "desc" }, { id: "desc" }],
    take: exportAll ? 10000 : 25,
    skip: exportAll ? 0 : (filters.page - 1) * 25,
  });
  return { tickets, total, page: filters.page };
}
export async function supportKpis(userId: string) {
  await requireSupportStaff(prisma, userId);
  const rows = await prisma.supportTicket.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts = { OPEN: 0, IN_PROGRESS: 0, WAITING_CUSTOMER: 0, RESOLVED: 0 };
  rows.forEach((row) => {
    counts[row.status] = row._count._all;
  });
  return counts;
}
export async function getSupportTicket(userId: string, id: string, staff = false) {
  if (staff) await requireSupportStaff(prisma, userId);
  const customer = staff ? null : (await customerIdentity(prisma, userId)).customer;
  const ticket = await prisma.supportTicket.findFirst({
    where: { id, ...(customer ? { customerId: customer.id } : {}) },
    select: {
      ...ticketSelect,
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
        select: { id: true, body: true, isStaff: true, createdAt: true },
      },
    },
  });
  if (!ticket) throw new AccountError("Ticket not found.", 404);
  return { ...ticket, messages: ticket.messages.reverse() };
}
export async function replyToSupportTicket(
  userId: string,
  id: string,
  input: unknown,
  staff = false,
) {
  const data = replySchema.parse(input);
  const requestHash = fingerprint({ ...data, staff });
  if (!staff && data.status !== undefined)
    throw new AccountError("Customers cannot change ticket status directly.", 403);
  return prisma.$transaction(async (tx) => {
    await accountIdentity(tx, userId, true);
    if (staff) await requireSupportStaff(tx, userId);
    const customer = staff ? null : (await customerIdentity(tx, userId)).customer;
    await tx.$queryRaw`SELECT id FROM "SupportTicket" WHERE id = ${id} FOR UPDATE`;
    const ticket = await tx.supportTicket.findFirst({
      where: { id, ...(customer ? { customerId: customer.id } : {}) },
    });
    if (!ticket) throw new AccountError("Ticket not found.", 404);
    const existing = await tx.supportMessage.findUnique({
      where: {
        ticketId_authorUserId_requestKey: {
          ticketId: id,
          authorUserId: userId,
          requestKey: data.requestKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new AccountError("This reply request was already used.", 409);
      return { id };
    }
    if (ticket.version !== data.version)
      throw new AccountError(
        "This ticket changed. Refresh to read the latest reply before sending.",
        409,
      );
    if (
      (await tx.supportMessage.count({
        where: { authorUserId: userId, createdAt: { gt: new Date(Date.now() - 300000) } },
      })) >= 20
    )
      throw new AccountError("Please wait before sending another reply.", 429);
    const status = staff ? (data.status ?? ticket.status) : "OPEN";
    await tx.supportMessage.create({
      data: {
        ticketId: id,
        authorUserId: userId,
        isStaff: staff,
        body: data.message,
        requestKey: data.requestKey,
        requestHash,
      },
    });
    await tx.supportTicket.update({
      where: { id },
      data: {
        status,
        version: { increment: 1 },
        resolvedAt: status === "RESOLVED" ? (ticket.resolvedAt ?? new Date()) : null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "support.ticket.replied",
        entityType: "SupportTicket",
        entityId: id,
        beforeJson: { status: ticket.status, version: ticket.version },
        afterJson: { status, version: ticket.version + 1, staff },
      },
    });
    return { id };
  });
}
