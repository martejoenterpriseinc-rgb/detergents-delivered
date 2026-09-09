import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ORDER_LABELS } from "@/lib/domain/account";
import type { getCustomerOrders } from "@/lib/services/customer-account";
export function AccountOrders({
  orders,
}: {
  orders: Awaited<ReturnType<typeof getCustomerOrders>>;
}) {
  if (!orders.length)
    return (
      <Card>
        <p>No saved orders yet.</p>
        <p className="mt-2 text-sm text-teal-700">
          Orders and delivery updates will appear here when recorded for your account.
        </p>
      </Card>
    );
  return (
    <div className="space-y-4">
      {orders.map((order) => {
        const stop = order.routeStops[0];
        return (
          <Card key={order.id} className="space-y-3">
            <div className="flex flex-wrap justify-between gap-3">
              <h3 className="font-semibold break-all">{order.number}</h3>
              <p>
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: order.currency,
                }).format(order.totalCents / 100)}
              </p>
            </div>
            <p className="text-sm font-semibold text-teal-800">
              {["DELIVERED", "CANCELLED", "REFUNDED"].includes(order.status)
                ? ORDER_LABELS[order.status]
                : stop?.arrivedAt
                  ? "Driver has arrived"
                  : stop?.startedAt
                    ? "Driver en route"
                    : stop?.route.status === "IN_PROGRESS"
                      ? "Your items will be delivered today"
                      : ORDER_LABELS[order.status]}
            </p>
            <p className="text-sm text-teal-800">
              Ordered{" "}
              {new Intl.DateTimeFormat("en-US", {
                timeZone: "America/Chicago",
                dateStyle: "medium",
              }).format(order.placedAt ?? order.createdAt)}
            </p>
            {stop && !["CANCELLED", "REFUNDED"].includes(order.status) && (
              <div className="rounded-xl bg-teal-50 p-3 text-sm">
                <p>Delivery date: {stop.route.serviceDate.toISOString().slice(0, 10)}</p>
                {stop.plannedArriveAt && !stop.completedAt && (
                  <p>
                    Planned arrival (route schedule):{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: "America/Chicago",
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(stop.plannedArriveAt)}{" "}
                    Central
                  </p>
                )}
                {stop.completedAt && (
                  <p>
                    Completed{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: "America/Chicago",
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(stop.completedAt)}{" "}
                    Central
                  </p>
                )}
              </div>
            )}
            {stop?.completedAt &&
              stop.deliveryAttempts[0]?.photos.map((photo) => (
                <a
                  key={photo.id}
                  className="inline-flex rounded-full border border-teal-200 px-4 py-2 text-sm font-semibold"
                  href={`/api/account/proof/${photo.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View delivery photo
                </a>
              ))}
            <p className="text-sm text-teal-800">
              {order.items.map((i) => `${i.nameSnapshot} × ${i.quantity}`).join(" · ")}
            </p>
            <Link
              className="inline-flex min-h-11 items-center rounded-full border border-teal-200 px-4 text-sm font-semibold text-teal-900 hover:bg-teal-50"
              href={`/account/support/new?orderId=${encodeURIComponent(order.id)}`}
            >
              Report a problem
            </Link>
          </Card>
        );
      })}
    </div>
  );
}
