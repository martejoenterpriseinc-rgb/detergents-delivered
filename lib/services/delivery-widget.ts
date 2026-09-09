import { prisma } from "@/lib/prisma";
import { accountIdentity } from "./customer-account";
import type { DeliverySnapshot } from "@/lib/domain/loyalty";
export async function getDeliveryWidget(userId: string): Promise<DeliverySnapshot> {
  const user = await accountIdentity(prisma, userId);
  const base = {
    source: "Saved order and route schedule" as const,
    checkedAt: new Date().toISOString(),
    plannedArrival: null,
    orderNumber: null,
  };
  if (!user.customer || user.customer.deletedAt) return { ...base, status: "NONE" };
  const customerId = user.customer.id;
  const select = {
    number: true,
    status: true,
    routeStops: {
      where: {
        address: { customerId },
        route: {
          status: { in: ["SCHEDULED", "IN_PROGRESS"] as ("SCHEDULED" | "IN_PROGRESS")[] },
        },
      },
      orderBy: { createdAt: "desc" as const },
      take: 1,
      select: {
        plannedArriveAt: true,
        startedAt: true,
        arrivedAt: true,
        completedAt: true,
        route: { select: { status: true } },
      },
    },
  };
  const active = await prisma.order.findFirst({
    where: { customerId, status: { in: ["PAID", "FULFILLING", "OUT_FOR_DELIVERY"] } },
    orderBy: [{ status: "desc" }, { createdAt: "asc" }],
    select,
  });
  const order =
    active ??
    (await prisma.order.findFirst({
      where: { customerId, status: { not: "DRAFT" } },
      orderBy: { updatedAt: "desc" },
      select,
    }));
  return order
    ? {
        ...base,
        status:
          order.status === "DELIVERED" || ["CANCELLED", "REFUNDED"].includes(order.status)
            ? order.status
            : order.routeStops[0]?.arrivedAt
              ? "ARRIVED"
              : order.routeStops[0]?.startedAt
                ? "EN_ROUTE"
                : order.routeStops[0]?.route.status === "IN_PROGRESS"
                  ? "TODAY"
                  : order.status,
        orderNumber: order.number,
        plannedArrival: order.routeStops[0]?.plannedArriveAt?.toISOString() ?? null,
      }
    : { ...base, status: "NONE" };
}
