import Link from "next/link";
import { formatCents } from "@/lib/domain/money";
import { ReceivingDesk } from "@/components/admin/receiving-desk";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function ReceivingPage() {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    include: {
      vendor: true,
      items: { include: { productVariant: { include: { product: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const batches = await prisma.receipt.findMany({
    include: {
      purchaseOrder: { include: { vendor: true } },
      items: { include: { productVariant: true } },
    },
    orderBy: { receivedAt: "desc" },
  });
  const receivable = purchaseOrders.filter((po) =>
    ["ORDERED", "SUBMITTED", "PARTIALLY_RECEIVED"].includes(po.status),
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Receiving</h1>
        <p className="mt-2 text-sm text-teal-800">
          Partial receipts, shortage, overage, and damage. Each post writes receipt lines
          and inventory transactions — balances are never silently overwritten.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="#batches" className="ops-panel p-5">
          <p>Batches received</p>
          <strong className="text-3xl">{batches.length}</strong>
        </Link>
        <Link href="#purchase-orders" className="ops-panel p-5">
          <p>All purchase orders</p>
          <strong className="text-3xl">{purchaseOrders.length}</strong>
        </Link>
        <Link href="#receive" className="ops-panel p-5">
          <p>Awaiting receipt</p>
          <strong className="text-3xl">{receivable.length}</strong>
        </Link>
      </div>
      <section id="batches" className="space-y-4">
        <h2 className="text-xl font-semibold">Received batches</h2>
        {!batches.length && <p>No batches received yet.</p>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {batches.map((batch) => (
            <article key={batch.id} className="ops-panel p-5">
              <h3 className="font-semibold">{batch.number}</h3>
              <p>
                {new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago" }).format(
                  batch.receivedAt,
                )}
              </p>
              <p>{batch.purchaseOrder?.vendor.name ?? "No purchase order vendor"}</p>
              <p>
                {batch.items.reduce((sum, item) => sum + item.quantityReceived, 0)} units
                received ·{" "}
                {batch.items.reduce((sum, item) => sum + item.quantityDamaged, 0)} damaged
              </p>
              <ul className="mt-3 text-sm">
                {batch.items.map((item) => (
                  <li key={item.id}>
                    {item.productVariant.sku} · {item.quantityReceived} received
                  </li>
                ))}
              </ul>
              {batch.purchaseOrder && (
                <Link
                  className="mt-3 block underline"
                  href={`/admin/purchase-orders/${batch.purchaseOrder.id}`}
                >
                  Open {batch.purchaseOrder.number}
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>
      <section id="purchase-orders" className="space-y-4">
        <h2 className="text-xl font-semibold">All purchase orders</h2>
        {!purchaseOrders.length && <p>No purchase orders yet.</p>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {purchaseOrders.map((po) => (
            <Link
              key={po.id}
              href={`/admin/purchase-orders/${po.id}`}
              className="ops-panel p-5 hover:border-teal-500"
            >
              <h3 className="font-semibold">{po.number}</h3>
              <p>{po.vendor.name}</p>
              <p className="my-2 text-sm font-semibold">
                {po.status.replaceAll("_", " ")}
              </p>
              <p>
                {po.items.reduce((sum, item) => sum + item.quantityReceived, 0)} /{" "}
                {po.items.reduce((sum, item) => sum + item.quantityOrdered, 0)} units
                received
              </p>
              <p>{formatCents(po.landedCostCents)} landed cost</p>
            </Link>
          ))}
        </div>
      </section>
      <section id="receive" className="space-y-4">
        <h2 className="text-xl font-semibold">Receive a purchase order</h2>
        <ReceivingDesk purchaseOrders={receivable} />
      </section>
    </div>
  );
}
