import { notFound } from "next/navigation";
import { VendorEditor } from "@/components/admin/vendor-editor";
import { VendorAttachments } from "@/components/admin/vendor-attachments";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  const { id } = await params;
  const vendor = await prisma.vendor.findFirst({
    where: { id, deletedAt: null },
    include: { purchaseOrders: { orderBy: { createdAt: "desc" }, take: 8 } },
  });
  if (!vendor) notFound();
  const attachments = await prisma.attachment.findMany({
    where: { entityType: "VENDOR", entityId: vendor.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-teal-950">{vendor.name}</h1>
      <VendorEditor vendor={vendor} />
      <VendorAttachments vendorId={vendor.id} attachments={attachments} />
      <Card>
        <h2 className="text-lg font-semibold text-teal-950">Recent purchase orders</h2>
        <ul className="mt-3 space-y-2 text-sm text-teal-800">
          {vendor.purchaseOrders.map((po) => (
            <li key={po.id}>
              {po.number} · {po.status}
            </li>
          ))}
          {vendor.purchaseOrders.length === 0 ? <li>None yet.</li> : null}
        </ul>
      </Card>
    </div>
  );
}
