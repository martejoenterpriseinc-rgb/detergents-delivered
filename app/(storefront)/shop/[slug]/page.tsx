import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/storefront/add-to-cart";
import { ProductMedia } from "@/components/storefront/product-media";
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

  const image = product.images[0] ?? product.variants[0]?.images[0];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <p className="text-sm text-teal-700">
        <Link href="/shop" className="hover:text-teal-950">
          Shop
        </Link>
        {" / "}
        {product.category?.name ?? "Household"}
      </p>
      <div className="mt-6 grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <ProductMedia
          name={product.name}
          brand={product.brand}
          form={product.form}
          imageId={image?.id}
          className="h-72 min-h-72 lg:h-full"
        />
        <div className="space-y-5">
          <p className="text-sm tracking-wide text-teal-700 uppercase">{product.brand}</p>
          <h1 className="text-3xl font-semibold text-teal-950">{product.name}</h1>
          {product.description ? (
            <p className="max-w-2xl text-teal-800">{product.description}</p>
          ) : null}
          <AddToCart
            productId={product.id}
            slug={product.slug}
            productName={product.name}
            brand={product.brand}
            variants={product.variants
              .map((variant) => {
                const selling = variant.salePrice ?? variant.retailPrice;
                return {
                  id: variant.id,
                  name: variant.name,
                  sku: variant.sku,
                  sizeLabel: variant.sizeLabel,
                  scent: variant.scent,
                  available: variant.available,
                  retailCents: variant.retailPrice?.amountCents ?? null,
                  unitPriceCents: selling?.amountCents ?? null,
                  subscriptionCents: variant.subscriptionPrice?.amountCents ?? null,
                  imageId: variant.images[0]?.id ?? image?.id ?? null,
                };
              })
              .sort((a, b) => (a.unitPriceCents ?? 0) - (b.unitPriceCents ?? 0))}
          />
        </div>
      </div>
    </div>
  );
}
