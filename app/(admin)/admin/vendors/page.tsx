import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  await requireRole("ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN");
  const vendors = await prisma.vendor.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-teal-950">Vendors</h1>
          <p className="mt-2 text-sm text-teal-800">Supplier records used by purchase orders.</p>
        </div>
        <Link href={"/admin/vendors/new" as Route}>
          <Button>New vendor</Button>
        </Link>
      </div>
      {vendors.length === 0 ? (
        <Card>
          <p className="text-sm text-teal-800">No vendors yet.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {vendors.map((vendor) => (
            <Link key={vendor.id} href={`/admin/vendors/${vendor.id}` as Route}>
              <Card>
                <p className="font-semibold text-teal-950">{vendor.name}</p>
                <p className="text-sm text-teal-700">
                  {[vendor.contactName, vendor.email, vendor.phone, vendor.paymentTerms]
                    .filter(Boolean)
                    .join(" · ") || "No contact yet"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
