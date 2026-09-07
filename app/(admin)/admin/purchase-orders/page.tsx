import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { formatCents } from "@/lib/domain/money";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  await requireRole("ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN");
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    include: { vendor: true, items: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-teal-950">Purchase orders</h1>
          <p className="mt-2 text-sm text-teal-800">
            Draft → ordered → partially received → received. Cancel is available until fully received.
          </p>
        </div>
        <Link href={"/admin/purchase-orders/new" as Route}>
          <Button>New PO</Button>
        </Link>
      </div>
      {purchaseOrders.length === 0 ? (
        <Card>
          <p className="text-sm text-teal-800">No purchase orders yet.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-teal-100 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-teal-100 text-xs uppercase text-teal-700">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Landed</th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrders.map((po) => (
                <tr key={po.id} className="border-b border-teal-50 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/purchase-orders/${po.id}` as Route}
                      className="font-medium text-teal-950 underline-offset-2 hover:underline"
                    >
                      {po.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-teal-800">{po.vendor.name}</td>
                  <td className="px-4 py-3 text-teal-800">{po.status}</td>
                  <td className="px-4 py-3 text-teal-800">{formatCents(po.landedCostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
