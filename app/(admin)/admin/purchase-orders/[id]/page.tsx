import { notFound } from "next/navigation";
import { PurchaseOrderEditor } from "@/components/admin/purchase-order-editor";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { formatCents } from "@/lib/domain/money";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  const { id } = await params;
  const [purchaseOrder, vendors, variants] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        vendor: true,
        items: { include: { productVariant: { include: { product: true } } } },
        receipts: { include: { items: true } },
      },
    }),
    prisma.vendor.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.productVariant.findMany({
      where: { deletedAt: null },
      include: { product: true },
      orderBy: { sku: "asc" },
    }),
  ]);
  if (!purchaseOrder) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-teal-950">{purchaseOrder.number}</h1>
      <p className="text-sm text-teal-800">{purchaseOrder.vendor.name}</p>
      <PurchaseOrderEditor vendors={vendors} variants={variants} purchaseOrder={purchaseOrder} />
      {purchaseOrder.receipts.length > 0 ? (
        <Card>
          <h2 className="text-lg font-semibold text-teal-950">Receipts</h2>
          <ul className="mt-3 space-y-2 text-sm text-teal-800">
            {purchaseOrder.receipts.map((receipt) => (
              <li key={receipt.id}>
                {receipt.number} · {receipt.items.length} lines · landed units{" "}
                {receipt.items
                  .map((item) =>
                    item.landedUnitCostCents !== null ? formatCents(item.landedUnitCostCents) : "—",
                  )
                  .join(", ")}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
