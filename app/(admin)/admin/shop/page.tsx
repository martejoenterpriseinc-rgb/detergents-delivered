import Link from "next/link";
import { requireRole } from "@/lib/authz";
import ProductsPage from "../products/page";
export default async function Page() {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Shop online</h1>
        <div className="flex gap-3">
          <Link className="ops-button" href="/admin/shop/new">
            Add inventory
          </Link>
          <Link className="ops-button secondary" href="/admin/receiving">
            Receive stock
          </Link>
        </div>
      </div>
      <ProductsPage />
    </div>
  );
}
