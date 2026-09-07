import { VendorEditor } from "@/components/admin/vendor-editor";
import { requireRole } from "@/lib/authz";

export default async function NewVendorPage() {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-teal-950">New vendor</h1>
      <VendorEditor />
    </div>
  );
}
