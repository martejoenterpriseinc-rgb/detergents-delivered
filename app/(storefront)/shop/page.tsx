import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ProductCard } from "@/components/storefront/product-card";
import {
  listShopCategories,
  listShopForms,
  listShopProducts,
  listShopScents,
} from "@/lib/catalog-public";
import { isShopProductForm, productFormLabel } from "@/lib/product-display";

export const dynamic = "force-dynamic";

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    form?: string;
    scent?: string;
    category?: string;
    stock?: string;
  }>;
}) {
  const params = await searchParams;
  const form = isShopProductForm(params.form) ? params.form : undefined;
  const [products, categories, forms, scents] = await Promise.all([
    listShopProducts({
      q: params.q,
      form,
      scent: params.scent,
      category: params.category,
      inStock: params.stock === "1",
    }),
    listShopCategories(),
    listShopForms(),
    listShopScents(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold text-teal-950">Shop household staples</h1>
      <p className="mt-2 max-w-2xl text-teal-800">
        In-stock detergent, dish, paper, and cleaners from the same warehouse we receive
        into. Filter by category, type, or scent — not by brand name.
      </p>
      <form className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <Input
          name="q"
          defaultValue={params.q}
          placeholder="Search type, scent, or SKU"
        />
        <Select name="category" defaultValue={params.category ?? ""}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.slug}>
              {category.name}
            </option>
          ))}
        </Select>
        <Select name="form" defaultValue={form ?? ""}>
          <option value="">All types</option>
          {forms.map((value) => (
            <option key={value} value={value}>
              {productFormLabel(value)}
            </option>
          ))}
        </Select>
        <Select name="scent" defaultValue={params.scent ?? ""}>
          <option value="">All scents</option>
          {scents.map((scent) => (
            <option key={scent} value={scent}>
              {scent}
            </option>
          ))}
        </Select>
        <Select name="stock" defaultValue={params.stock ?? ""}>
          <option value="">All availability</option>
          <option value="1">In stock</option>
        </Select>
        <button
          type="submit"
          className="h-11 rounded-full bg-teal-700 px-5 text-sm font-semibold text-white sm:col-span-2 lg:col-span-5 lg:w-fit"
        >
          Apply filters
        </button>
      </form>
      {products.length === 0 ? (
        <Card className="mt-8">
          <p className="text-sm font-medium text-teal-900">Nothing matches yet</p>
          <p className="mt-2 text-sm text-teal-800">
            Try another filter, or seed the demo catalog with DEMO_MODE=true /
            SEED_DEMO_CATALOG=true so the shop has household products to show.
          </p>
        </Card>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
