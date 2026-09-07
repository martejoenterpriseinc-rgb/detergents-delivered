import Link from "next/link";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await requirePermission("catalog.read");

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: {
      category: true,
      variants: {
        where: { deletedAt: null },
        orderBy: { sku: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Products</h1>
        <p className="mt-2 text-sm text-teal-800">
          Phase 2 scaffold: list wired to Postgres. Catalog management is not an
          MVP yet.
        </p>
      </div>
      {products.length === 0 ? (
        <Card>
          <p className="text-sm font-medium text-teal-900">No products yet</p>
          <p className="mt-2 text-sm text-teal-800">
            Create a category and product through{" "}
            <code className="rounded bg-teal-50 px-1">POST /api/categories</code>{" "}
            and <code className="rounded bg-teal-50 px-1">POST /api/products</code>{" "}
            or wait for the Phase 2 admin forms.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-teal-100 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-teal-100 text-xs uppercase tracking-wide text-teal-700">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Variants</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-teal-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-teal-950">{product.name}</td>
                  <td className="px-4 py-3 text-teal-800">{product.brand}</td>
                  <td className="px-4 py-3 text-teal-800">
                    {product.category?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-teal-800">
                    {product.variants.map((variant) => variant.sku).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-teal-700">
        API stubs: <Link href="/api/products">/api/products</Link>
      </p>
    </div>
  );
}
