import Link from "next/link";
import type { Route } from "next";
import { Card } from "@/components/ui/card";
import { ProductMedia } from "@/components/storefront/product-media";
import { formatCents } from "@/lib/domain/money";
import { productFormLabel } from "@/lib/product-display";

type ShopProductCard = {
  id: string;
  slug: string;
  name: string;
  form?: string | null;
  category?: { name: string } | null;
  images: Array<{ id: string }>;
  variants: Array<{
    available: number;
    scent: string | null;
    salePrice: { amountCents: number } | null;
    retailPrice: { amountCents: number } | null;
    images: Array<{ id: string }>;
  }>;
};

export function ProductCard({ product }: { product: ShopProductCard }) {
  const priceCents = product.variants
    .map((variant) => variant.salePrice?.amountCents ?? variant.retailPrice?.amountCents)
    .filter((amount): amount is number => typeof amount === "number");
  const lowest = priceCents.length > 0 ? Math.min(...priceCents) : null;
  const image = product.images[0] ?? product.variants[0]?.images[0];
  const available = product.variants.reduce((sum, variant) => sum + variant.available, 0);
  const scents = [
    ...new Set(product.variants.map((variant) => variant.scent).filter(Boolean)),
  ];
  const eyebrow = scents[0] ?? product.category?.name ?? productFormLabel(product.form);

  return (
    <Link href={`/shop/${product.slug}` as Route} className="block h-full">
      <Card className="flex h-full flex-col gap-3 p-4 transition-shadow hover:shadow-md">
        <ProductMedia
          name={product.name}
          form={product.form}
          imageId={image?.id}
          className="h-44"
        />
        <p className="text-xs font-semibold tracking-wide text-teal-700 uppercase">
          {eyebrow}
        </p>
        <p className="text-lg leading-snug font-semibold text-teal-950">{product.name}</p>
        <p className="mt-auto text-sm text-teal-800">
          {lowest !== null ? `From ${formatCents(lowest)}` : "See details"}
          {" · "}
          {available > 0 ? `${available} in stock` : "See availability"}
        </p>
      </Card>
    </Link>
  );
}
