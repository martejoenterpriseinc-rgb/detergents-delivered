import { requireRole } from "@/lib/authz";
import { ShopEntryForm } from "@/components/admin/shop-entry-form";
import { catalogUploadReady } from "@/lib/services/shop-entry";
export default async function Page() {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-3xl font-semibold">Add inventory product</h1>
      <p>
        Add the product, its pricing and vehicle load. Receive stock through the inventory
        ledger before it becomes available in the shop.
      </p>
      <ShopEntryForm imageReady={catalogUploadReady()} />
    </div>
  );
}
