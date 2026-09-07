import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/authz";
import { availableQty } from "@/lib/domain/inventory";
import { formatCents } from "@/lib/domain/money";
import { pickCurrentPrice } from "@/lib/prices";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await requirePermission("catalog.read");

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: {
      category: true,
      variants: {
        where: { deletedAt: null },
        include: { prices: true, inventoryBalance: true, costLayers: true },
        orderBy: { sku: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-teal-950">Products</h1>
          <p className="mt-2 text-sm text-teal-800">
            Catalog, variants, and prices. Received + published items appear on the shop immediately.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={"/admin/categories" as Route}>
            <Button variant="outline">Categories</Button>
          </Link>
          <Link href={"/admin/products/new" as Route}>
            <Button>New product</Button>
          </Link>
        </div>
      </div>
      {products.length === 0 ? (
        <Card>
          <p className="text-sm font-medium text-teal-900">No products yet</p>
          <p className="mt-2 text-sm text-teal-800">
            Create a category, then a product with variants and prices.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-teal-100 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-teal-100 text-xs uppercase tracking-wide text-teal-700">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Website</th>
                <th className="px-4 py-3">Variants</th>
                <th className="px-4 py-3">Available</th>
                <th className="px-4 py-3">Landed</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const available = product.variants.reduce(
                  (sum, variant) =>
                    sum + availableQty(variant.inventoryBalance ?? { onHandQty: 0, reservedQty: 0 }),
                  0,
                );
                const layerValue = product.variants.reduce(
                  (sum, variant) =>
                    sum +
                    variant.costLayers.reduce(
                      (inner, layer) => inner + layer.quantityRemaining * layer.landedUnitCostCents,
                      0,
                    ),
                  0,
                );
                return (
                  <tr key={product.id} className="border-b border-teal-50 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/products/${product.id}` as Route}
                        className="font-medium text-teal-950 underline-offset-2 hover:underline"
                      >
                        {product.name}
                      </Link>
                      <div className="text-xs text-teal-700">
                        {product.brand}
                        {product.category ? ` · ${product.category.name}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-teal-800">
                      {product.websiteVisible ? "Visible" : "Hidden"}
                    </td>
                    <td className="px-4 py-3 text-teal-800">
                      {product.variants
                        .map((variant) => {
                          const price = pickCurrentPrice(variant.prices);
                          return `${variant.sku}${price ? ` ${formatCents(price.amountCents)}` : ""}`;
                        })
                        .join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-teal-800">{available}</td>
                    <td className="px-4 py-3 text-teal-800">
                      {layerValue ? formatCents(layerValue) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
