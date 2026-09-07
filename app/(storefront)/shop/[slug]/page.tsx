import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { formatCents } from "@/lib/domain/money";
import { getShopProduct } from "@/lib/catalog-public";

export const dynamic = "force-dynamic";

export default async function ShopProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getShopProduct(slug);
  if (!product) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <p className="text-sm uppercase tracking-wide text-teal-700">{product.brand}</p>
      <h1 className="mt-2 text-3xl font-semibold text-teal-950">{product.name}</h1>
      {product.description ? (
        <p className="mt-3 max-w-2xl text-teal-800">{product.description}</p>
      ) : null}
      <div className="mt-8 grid gap-4">
        {product.variants.map((variant) => {
          const selling = variant.salePrice ?? variant.retailPrice;
          return (
            <Card key={variant.id} className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-teal-950">{variant.name}</p>
                  <p className="text-xs text-teal-700">
                    SKU {variant.sku}
                    {variant.upc ? ` · UPC ${variant.upc}` : ""}
                    {variant.sizeLabel ? ` · ${variant.sizeLabel}` : ""}
                    {variant.scent ? ` · ${variant.scent}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  {selling ? (
                    <p className="text-xl font-semibold text-teal-950">
                      {formatCents(selling.amountCents)}
                    </p>
                  ) : (
                    <p className="text-sm text-teal-700">Price coming soon</p>
                  )}
                  {variant.subscriptionPrice ? (
                    <p className="text-xs text-teal-700">
                      Subscribe {formatCents(variant.subscriptionPrice.amountCents)}
                    </p>
                  ) : null}
                </div>
              </div>
              <p className="text-sm text-teal-800">{variant.available} available</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
