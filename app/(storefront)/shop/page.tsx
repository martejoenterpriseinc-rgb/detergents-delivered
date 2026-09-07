import Link from "next/link";
import type { Route } from "next";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatCents } from "@/lib/domain/money";
import { listShopBrands, listShopCategories, listShopProducts } from "@/lib/catalog-public";

export const dynamic = "force-dynamic";

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brand?: string; category?: string; stock?: string }>;
}) {
  const params = await searchParams;
  const [products, categories, brands] = await Promise.all([
    listShopProducts({
      q: params.q,
      brand: params.brand,
      category: params.category,
      inStock: params.stock === "1",
    }),
    listShopCategories(),
    listShopBrands(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-teal-950">Shop</h1>
      <p className="mt-2 max-w-2xl text-teal-800">
        Live catalog from the same inventory database. Products appear after they are received and
        published.
      </p>
      <form className="mt-8 grid gap-3 sm:grid-cols-4" method="get">
        <Input name="q" defaultValue={params.q} placeholder="Search products or SKU" />
        <Select name="category" defaultValue={params.category ?? ""}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.slug}>
              {category.name}
            </option>
          ))}
        </Select>
        <Select name="brand" defaultValue={params.brand ?? ""}>
          <option value="">All brands</option>
          {brands.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </Select>
        <Select name="stock" defaultValue={params.stock ?? ""}>
          <option value="">All availability</option>
          <option value="1">In stock</option>
        </Select>
        <button
          type="submit"
          className="h-11 rounded-full bg-teal-700 px-5 text-sm font-semibold text-white sm:col-span-4 sm:w-fit"
        >
          Filter
        </button>
      </form>
      {products.length === 0 ? (
        <Card className="mt-8">
          <p className="text-sm font-medium text-teal-900">Nothing in the shop yet</p>
          <p className="mt-2 text-sm text-teal-800">
            Receive inventory and mark the product website-visible in admin.
          </p>
        </Card>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const price =
              product.variants[0]?.salePrice ??
              product.variants[0]?.retailPrice ??
              null;
            const image = product.images[0] ?? product.variants[0]?.images[0];
            return (
              <Link key={product.id} href={`/shop/${product.slug}` as Route}>
                <Card className="h-full space-y-3">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/catalog/media/${image.id}`}
                      alt={image.alt ?? product.name}
                      className="h-40 w-full rounded-2xl object-cover bg-teal-50"
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center rounded-2xl bg-teal-50 text-sm text-teal-700">
                      {product.brand}
                    </div>
                  )}
                  <p className="text-xs uppercase tracking-wide text-teal-700">{product.brand}</p>
                  <p className="text-lg font-semibold text-teal-950">{product.name}</p>
                  <p className="text-sm text-teal-800">
                    {price ? formatCents(price.amountCents) : "See details"}
                    {" · "}
                    {product.variants.reduce((sum, variant) => sum + variant.available, 0)} in stock
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
