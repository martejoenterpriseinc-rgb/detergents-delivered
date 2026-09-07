import { ReceivingDesk } from "@/components/admin/receiving-desk";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function ReceivingPage() {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { status: { in: ["ORDERED", "SUBMITTED", "PARTIALLY_RECEIVED"] } },
    include: {
      vendor: true,
      items: { include: { productVariant: { include: { product: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Receiving</h1>
        <p className="mt-2 text-sm text-teal-800">
          Partial receipts, shortage, overage, and damage. Each post writes receipt lines and
          inventory transactions — balances are never silently overwritten.
        </p>
      </div>
      <ReceivingDesk purchaseOrders={purchaseOrders} />
    </div>
  );
}
