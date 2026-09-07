import Link from "next/link";
import type { Route } from "next";
import { Card } from "@/components/ui/card";
import { ProductMedia } from "@/components/storefront/product-media";
import { formatCents } from "@/lib/domain/money";

type ShopProductCard = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  form?: string | null;
  images: Array<{ id: string }>;
  variants: Array<{
    available: number;
    salePrice: { amountCents: number } | null;
    retailPrice: { amountCents: number } | null;
    images: Array<{ id: string }>;
  }>;
};

export function ProductCard({ product }: { product: ShopProductCard }) {
  const price =
    product.variants[0]?.salePrice ?? product.variants[0]?.retailPrice ?? null;
  const image = product.images[0] ?? product.variants[0]?.images[0];
  const available = product.variants.reduce((sum, variant) => sum + variant.available, 0);

  return (
    <Link href={`/shop/${product.slug}` as Route} className="block h-full">
      <Card className="flex h-full flex-col gap-3 p-4 transition-shadow hover:shadow-md">
        <ProductMedia
          name={product.name}
          brand={product.brand}
          form={product.form}
          imageId={image?.id}
          className="h-44"
        />
        <p className="text-xs font-semibold tracking-wide text-teal-700 uppercase">
          {product.brand}
        </p>
        <p className="text-lg leading-snug font-semibold text-teal-950">{product.name}</p>
        <p className="mt-auto text-sm text-teal-800">
          {price ? `From ${formatCents(price.amountCents)}` : "See details"}
          {" · "}
          {available > 0 ? `${available} in stock` : "See availability"}
        </p>
      </Card>
    </Link>
  );
}
