import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/authz";
import { getOrder } from "@/lib/services/order-workspace";
import { AccountError } from "@/lib/domain/account";
import { orderMoney, orderStatusLabels } from "@/lib/domain/order-workspace";
import { ReconcileButton } from "@/components/commerce/admin-actions";
import {
  ReceiveOrderReturn,
  CancelRefundDraft,
} from "@/components/commerce/order-returns";

const refundLabels: Record<string, string> = {
  PREPARED: "Draft — not submitted",
  SUBMITTING: "Submitting",
  UNKNOWN: "Needs reconciliation",
  PENDING: "Pending with payment provider",
  REQUIRES_ACTION: "Action required",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

const dateTime = (value: string) =>
  new Date(value).toLocaleString("en-US", { timeZone: "America/Chicago" }) + " Chicago";
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  let order: Awaited<ReturnType<typeof getOrder>>;
  try {
    order = await getOrder(session.user.id, (await params).id);
  } catch (error) {
    if (error instanceof AccountError && error.status === 404) notFound();
    throw error;
  }
  const money = (value: number) => orderMoney(value, order.currency);
  const amounts: [string, number][] = [
    ["Subtotal", order.amounts.subtotalCents],
    ["Discount", -order.amounts.discountCents],
    ["Delivery", order.amounts.shippingCents],
    ["Tax", order.amounts.taxCents],
    ["Total", order.amounts.totalCents],
  ];
  return (
    <div className="space-y-6">
      <Link href="/admin/orders" className="underline">
        Back to orders
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 break-words">
          <h1 className="text-3xl font-semibold">{order.number}</h1>
          <p className="mt-2">{orderStatusLabels[order.status]}</p>
          <p className="text-sm text-teal-800">Created {dateTime(order.createdAt)}</p>
        </div>
        <strong className="text-2xl">{money(order.amounts.totalCents)}</strong>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="min-w-0 rounded-xl border bg-white p-5 break-words">
          <h2 className="text-xl font-semibold">Customer & delivery address</h2>
          <p className="mt-3">{order.customer}</p>
          <p>{order.email}</p>
          {order.address ? (
            <address className="mt-3 not-italic">
              {order.address.line1}
              <br />
              {order.address.line2 && (
                <>
                  {order.address.line2}
                  <br />
                </>
              )}
              {order.address.city}, {order.address.region} {order.address.postalCode}
              <br />
              {order.address.country}
            </address>
          ) : (
            <p className="mt-3 text-teal-800">
              No confirmed delivery address saved on this order.
            </p>
          )}
          {order.notes && <p className="mt-3 whitespace-pre-wrap">{order.notes}</p>}
        </section>
        <section className="rounded-xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Order amounts</h2>
          <dl className="mt-3 space-y-2">
            {amounts.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt>{label}</dt>
                <dd>{money(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-teal-800">
            Saved order amounts. Refund records appear separately below.
          </p>
          <p className="mt-2 text-sm">
            FIFO cost at sale:{" "}
            {order.cogsCents === null ? "Not fully recorded" : money(order.cogsCents)}
          </p>
        </section>
      </div>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Purchased items</h2>
        {!order.items.length && <p>No item snapshots recorded.</p>}
        {order.items.map((item) => (
          <article
            key={item.id}
            className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0 break-words">
              <h3 className="font-semibold">{item.nameSnapshot}</h3>
              <p className="text-sm">SKU {item.skuSnapshot}</p>
              <p>
                {item.quantity} × {money(item.unitPriceCents)}
              </p>
              <p className="text-sm text-teal-800">
                Discount {money(item.discountCents)} · Tax {money(item.taxCents)}
              </p>
            </div>
            <strong>{money(item.lineTotalCents)}</strong>
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Payment evidence</h2>
        {order.checkout && (
          <div className="rounded-xl border bg-white p-4">
            <p>Checkout: {order.checkout.state.replaceAll("_", " ").toLowerCase()}</p>
            {order.checkout.canReconcile && (
              <div className="mt-3">
                <ReconcileButton id={order.checkout.id} />
              </div>
            )}
          </div>
        )}
        {!order.payments.length && (
          <p>No payment record. Do not treat the order total as collected funds.</p>
        )}
        {order.payments.map((payment) => (
          <article key={payment.id} className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <strong>{orderMoney(payment.amountCents, payment.currency)}</strong>
              <span>
                {payment.provider} · {payment.status.replaceAll("_", " ").toLowerCase()}
              </span>
            </div>
            <p className="mt-2">
              {payment.verified
                ? "Verified provider event recorded"
                : "Provider verification not recorded"}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-teal-800">
              {payment.events.map((event, index) => (
                <li key={index}>
                  {event.type} · {dateTime(event.createdAt)}
                  {event.verifiedAt ? " · verified" : ""}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Refund requests</h2>
        {!order.refundRequests.length && <p>No refund requests recorded.</p>}
        {order.refundRequests.map((request) => (
          <article key={request.id} className="space-y-3 rounded-xl border bg-white p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <strong>{orderMoney(request.amountCents, request.currency)}</strong>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                {refundLabels[request.status] ?? request.status}
              </span>
            </div>
            <p className="break-words">{request.reason}</p>
            <ul className="space-y-1 text-sm">
              {request.lines.map((line) => (
                <li key={line.orderItemId}>
                  {line.quantity} ×{" "}
                  {order.items.find((item) => item.id === line.orderItemId)
                    ?.nameSnapshot ?? "Purchased item"}
                </li>
              ))}
            </ul>
            <p className="text-sm text-teal-800">Updated {dateTime(request.updatedAt)}</p>
            {request.canCancel && (
              <CancelRefundDraft orderId={order.id} requestId={request.id} />
            )}
          </article>
        ))}
        {order.refundRequests.length === 100 && (
          <p className="text-sm">Showing the latest 100 refund requests.</p>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Returned goods</h2>
        {order.canReceiveReturn && (
          <ReceiveOrderReturn orderId={order.id} items={order.items} />
        )}
        {!order.stockReturns.length && <p>No goods received back.</p>}
        {order.stockReturns.map((record) => (
          <article key={record.id} className="space-y-2 rounded-xl border bg-white p-4">
            <strong>Received {dateTime(record.receivedAt)}</strong>
            <p className="break-words">{record.reason}</p>
            <ul className="space-y-2">
              {record.lines.map((line) => (
                <li
                  key={line.orderItemId}
                  className="flex flex-wrap justify-between gap-2"
                >
                  <span className="min-w-0 break-words">
                    {line.quantity} ×{" "}
                    {order.items.find((item) => item.id === line.orderItemId)
                      ?.nameSnapshot ?? "Purchased item"}
                  </span>
                  <span>
                    {line.condition === "SELLABLE" ? "Sellable stock" : "Damaged stock"}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
        {order.stockReturns.length === 100 && (
          <p className="text-sm">Showing the latest 100 goods receipts.</p>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Recorded refunds</h2>
        {!order.refunds.length && <p>No refunds recorded.</p>}
        {order.refunds.map((refund) => (
          <article key={refund.id} className="rounded-xl border bg-white p-4">
            <strong>{orderMoney(refund.amountCents, refund.currency)}</strong>
            <p className="break-words">{refund.reason || "No reason recorded"}</p>
            <p className="text-sm">{dateTime(refund.createdAt)}</p>
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Tax snapshot</h2>
        {order.tax ? (
          <p className="rounded-xl border bg-white p-4">
            {order.tax.provider} · {orderMoney(order.tax.taxCents, order.tax.currency)}{" "}
            saved tax on {orderMoney(order.tax.taxableCents, order.tax.currency)} taxable
            value.
          </p>
        ) : (
          <p>No provider tax snapshot recorded.</p>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Delivery progress</h2>
        {!order.deliveries.length && <p>No delivery route assigned.</p>}
        {order.deliveries.map((delivery) => (
          <article
            key={delivery.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white p-4"
          >
            <div className="min-w-0 break-words">
              <strong>
                {delivery.date} · stop {delivery.sequence}
              </strong>
              <p>{delivery.route}</p>
              <p>
                {delivery.completedAt
                  ? "Stop completed"
                  : delivery.status.replaceAll("_", " ").toLowerCase()}
              </p>
            </div>
            {order.canManage && (
              <Link
                className="ops-button"
                href={`/admin/deliveries?date=${delivery.date}`}
              >
                Open delivery day
              </Link>
            )}
          </article>
        ))}
        {order.attempts.map((attempt) => (
          <article key={attempt.id} className="rounded-xl border bg-white p-4">
            <strong>{attempt.result.replaceAll("_", " ").toLowerCase()}</strong>
            <p>
              {dateTime(attempt.attemptedAt)} · {attempt.photoCount} proof photos
            </p>
            {attempt.notes && <p className="break-words">{attempt.notes}</p>}
          </article>
        ))}
        {order.attempts.length === 100 && (
          <p className="text-sm">Showing the latest 100 delivery attempts.</p>
        )}
      </section>
    </div>
  );
}
