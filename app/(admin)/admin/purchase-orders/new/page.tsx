import { PurchaseOrderEditor } from "@/components/admin/purchase-order-editor";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  const [vendors, variants] = await Promise.all([
    prisma.vendor.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.productVariant.findMany({
      where: { deletedAt: null },
      include: { product: true },
      orderBy: { sku: "asc" },
    }),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-teal-950">New purchase order</h1>
      <PurchaseOrderEditor vendors={vendors} variants={variants} />
    </div>
  );
}
