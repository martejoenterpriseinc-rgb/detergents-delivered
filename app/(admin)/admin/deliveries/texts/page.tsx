import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { operationsStaff } from "@/lib/services/operations";
import { prisma } from "@/lib/prisma";
import { DeliveryTexts } from "@/components/admin/delivery-texts";
export default async function Page() {
  const session = await requireRole("ADMIN", "SUPER_ADMIN");
  await operationsStaff(prisma, session.user.id);
  return (
    <div className="space-y-6">
      <Link href="/admin/deliveries" className="font-semibold underline">
        Back to deliveries
      </Link>
      <h1 className="text-3xl font-semibold">Delivery text messages</h1>
      <DeliveryTexts />
    </div>
  );
}
