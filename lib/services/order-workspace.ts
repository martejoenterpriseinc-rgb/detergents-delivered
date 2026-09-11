import {
  effectiveRefundCents,
  refundAccountingSelect,
} from "@/lib/domain/refund-settlement";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountIdentity } from "@/lib/services/customer-account";
import { AccountError } from "@/lib/domain/account";
import { hasPermission, permissionsForRoles } from "@/lib/domain/authz";
import { orderFilters, orderId } from "@/lib/domain/order-workspace";
import { financeDayStart } from "@/lib/domain/finance";

async function access(tx: Prisma.TransactionClient, userId: string) {
  const user = await accountIdentity(tx, userId);
  const permissions = permissionsForRoles(user.userRoles.map((r) => r.role.code));
  if (!hasPermission(permissions, "orders.read"))
    throw new AccountError("Order access required.", 403);
  return hasPermission(permissions, "orders.write");
}
const summarySelect = {
  id: true,
  number: true,
  status: true,
  currency: true,
  totalCents: true,
  createdAt: true,
  placedAt: true,
  customer: {
    select: { firstName: true, lastName: true, user: { select: { email: true } } },
  },
  _count: { select: { items: true } },
  checkoutAttempt: { select: { state: true } },
} satisfies Prisma.OrderSelect;

export async function listOrders(userId: string, input: unknown) {
  const filters = orderFilters.parse(input);
  return prisma.$transaction(
    async (tx) => {
      const canManage = await access(tx, userId);
      const q = { contains: filters.q, mode: "insensitive" as const };
      const tomorrow = filters.to
        ? new Date(new Date(filters.to + "T00:00:00Z").getTime() + 86400000)
            .toISOString()
            .slice(0, 10)
        : undefined;
      const base: Prisma.OrderWhereInput = {
        ...(filters.q
          ? {
              OR: [
                { number: q },
                { customer: { firstName: q } },
                { customer: { lastName: q } },
                { customer: { user: { email: q } } },
                { items: { some: { skuSnapshot: q } } },
              ],
            }
          : {}),
        ...(filters.from || tomorrow
          ? {
              createdAt: {
                ...(filters.from ? { gte: financeDayStart(filters.from) } : {}),
                ...(tomorrow ? { lt: financeDayStart(tomorrow) } : {}),
              },
            }
          : {}),
      };
      const where: Prisma.OrderWhereInput = {
        ...base,
        ...(filters.status !== "ALL" ? { status: filters.status } : {}),
        ...(filters.view === "review" ? { checkoutAttempt: { state: "REVIEW" } } : {}),
      };
      const [records, count, groups, reviewCount] = await Promise.all([
        tx.order.findMany({
          where,
          select: summarySelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (filters.page - 1) * 50,
          take: 50,
        }),
        tx.order.count({ where }),
        tx.order.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
        tx.order.count({ where: { ...base, checkoutAttempt: { state: "REVIEW" } } }),
      ]);
      return {
        filters,
        canManage,
        count,
        reviewCount,
        statusCounts: Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
        rows: records.map((r) => ({
          id: r.id,
          number: r.number,
          status: r.status,
          currency: r.currency,
          totalCents: r.totalCents,
          createdAt: r.createdAt.toISOString(),
          placedAt: r.placedAt?.toISOString() ?? null,
          customer:
            [r.customer.firstName, r.customer.lastName].filter(Boolean).join(" ") ||
            "Household",
          email: r.customer.user.email,
          itemLines: r._count.items,
          review: r.checkoutAttempt?.state === "REVIEW",
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function getOrder(userId: string, input: unknown) {
  const id = orderId.parse(input);
  return prisma.$transaction(
    async (tx) => {
      const canManage = await access(tx, userId);
      const r = await tx.order.findUnique({
        where: { id },
        select: {
          ...summarySelect,
          subtotalCents: true,
          discountCents: true,
          shippingCents: true,
          taxCents: true,
          notes: true,
          address: {
            select: {
              line1: true,
              line2: true,
              city: true,
              region: true,
              postalCode: true,
              country: true,
            },
          },
          items: {
            select: {
              id: true,
              nameSnapshot: true,
              skuSnapshot: true,
              quantity: true,
              unitPriceCents: true,
              discountCents: true,
              taxCents: true,
              lineTotalCents: true,
            },
            orderBy: { id: "asc" },
          },
          payments: {
            select: {
              id: true,
              provider: true,
              status: true,
              amountCents: true,
              currency: true,
              createdAt: true,
              events: {
                select: { type: true, verifiedAt: true, createdAt: true },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          refunds: {
            select: {
              ...refundAccountingSelect,
              id: true,
              amountCents: true,
              currency: true,
              reason: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
          refundRequests: {
            select: {
              id: true,
              amountCents: true,
              currency: true,
              reason: true,
              status: true,
              createdAt: true,
              updatedAt: true,
              submittedAt: true,
              providerRefundId: true,
              lines: {
                select: {
                  orderItemId: true,
                  quantity: true,
                  netCents: true,
                  taxCents: true,
                },
              },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 100,
          },
          stockReturns: {
            select: {
              id: true,
              reason: true,
              receivedAt: true,
              lines: { select: { orderItemId: true, quantity: true, condition: true } },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 100,
          },
          taxCalculation: {
            select: {
              provider: true,
              taxCents: true,
              taxableCents: true,
              currency: true,
              createdAt: true,
            },
          },
          checkoutAttempt: {
            select: {
              id: true,
              state: true,
              stripeSessionId: true,
              serviceDate: true,
              costs: {
                where: { state: "CONSUMED" },
                select: { quantity: true, unitCostCents: true },
              },
            },
          },
          routeStops: {
            select: {
              id: true,
              sequence: true,
              completedAt: true,
              route: { select: { number: true, status: true, serviceDate: true } },
            },
            orderBy: { createdAt: "asc" },
          },
          deliveryAttempts: {
            select: {
              id: true,
              result: true,
              notes: true,
              attemptedAt: true,
              _count: { select: { photos: true } },
            },
            orderBy: { attemptedAt: "desc" },
            take: 100,
          },
        },
      });
      if (!r) throw new AccountError("Order not found.", 404);
      const costs = r.checkoutAttempt?.costs ?? [];
      const itemQuantity = r.items.reduce((sum, item) => sum + item.quantity, 0);
      const allocatedQuantity = costs.reduce((sum, cost) => sum + cost.quantity, 0);
      const returned = await tx.stockReturnLine.groupBy({
        by: ["orderItemId"],
        where: { stockReturn: { orderId: id } },
        _sum: { quantity: true },
      });
      const returnedByItem = new Map(
        returned.map((line) => [line.orderItemId, line._sum.quantity ?? 0]),
      );
      return {
        id: r.id,
        number: r.number,
        status: r.status,
        currency: r.currency,
        canManage,
        createdAt: r.createdAt.toISOString(),
        placedAt: r.placedAt?.toISOString() ?? null,
        customer:
          [r.customer.firstName, r.customer.lastName].filter(Boolean).join(" ") ||
          "Household",
        email: r.customer.user.email,
        address: r.address,
        notes: r.notes,
        items: r.items.map((item) => ({
          ...item,
          returnedQuantity: returnedByItem.get(item.id) ?? 0,
        })),
        canReceiveReturn:
          canManage &&
          r.checkoutAttempt?.state === "PAID" &&
          ["PAID", "FULFILLING", "OUT_FOR_DELIVERY", "DELIVERED", "REFUNDED"].includes(
            r.status,
          ) &&
          itemQuantity === allocatedQuantity &&
          costs.length > 0,
        amounts: {
          subtotalCents: r.subtotalCents,
          discountCents: r.discountCents,
          shippingCents: r.shippingCents,
          taxCents: r.taxCents,
          totalCents: r.totalCents,
        },
        cogsCents:
          costs.length && itemQuantity === allocatedQuantity
            ? costs.reduce((sum, cost) => sum + cost.quantity * cost.unitCostCents, 0)
            : null,
        payments: r.payments.map((p) => ({
          id: p.id,
          provider: p.provider,
          status: p.status,
          amountCents: p.amountCents,
          currency: p.currency,
          createdAt: p.createdAt.toISOString(),
          verified: p.events.some((e) => e.verifiedAt !== null),
          events: p.events.map((e) => ({
            type: e.type,
            createdAt: e.createdAt.toISOString(),
            verifiedAt: e.verifiedAt?.toISOString() ?? null,
          })),
        })),
        refunds: r.refunds.map(({ request, ...f }) => ({
          ...f,
          originalAmountCents: f.amountCents,
          amountCents: effectiveRefundCents({ ...f, request }),
          createdAt: f.createdAt.toISOString(),
        })),
        refundRequests: r.refundRequests.map((request) => ({
          id: request.id,
          amountCents: request.amountCents,
          currency: request.currency,
          reason: request.reason,
          status: request.status,
          createdAt: request.createdAt.toISOString(),
          updatedAt: request.updatedAt.toISOString(),
          canCancel:
            canManage &&
            request.status === "PREPARED" &&
            !request.submittedAt &&
            !request.providerRefundId,
          lines: request.lines,
        })),
        stockReturns: r.stockReturns.map((record) => ({
          ...record,
          receivedAt: record.receivedAt.toISOString(),
        })),
        tax: r.taxCalculation
          ? { ...r.taxCalculation, createdAt: r.taxCalculation.createdAt.toISOString() }
          : null,
        checkout: r.checkoutAttempt
          ? {
              id: r.checkoutAttempt.id,
              state: r.checkoutAttempt.state,
              serviceDate: r.checkoutAttempt.serviceDate,
              canReconcile:
                canManage &&
                Boolean(r.checkoutAttempt.stripeSessionId) &&
                !["PAID", "EXPIRED", "REFUNDED"].includes(r.checkoutAttempt.state),
            }
          : null,
        deliveries: r.routeStops.map((s) => ({
          id: s.id,
          sequence: s.sequence,
          completedAt: s.completedAt?.toISOString() ?? null,
          route: s.route.number,
          status: s.route.status,
          date: s.route.serviceDate.toISOString().slice(0, 10),
        })),
        attempts: r.deliveryAttempts.map((a) => ({
          id: a.id,
          result: a.result,
          notes: a.notes,
          attemptedAt: a.attemptedAt.toISOString(),
          photoCount: a._count.photos,
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
