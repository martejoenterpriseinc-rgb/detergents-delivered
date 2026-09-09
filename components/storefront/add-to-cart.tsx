"use client";

import { PurchaseCheck } from "@/components/storefront/purchase-check";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/storefront/cart-provider";
import { formatCents } from "@/lib/domain/money";
import type { CartLine } from "@/lib/cart";

export type AddToCartVariant = {
  id: string;
  name: string;
  sku: string;
  sizeLabel: string | null;
  scent: string | null;
  available: number;
  unitPriceCents: number | null;
  subscriptionCents: number | null;
  imageId: string | null;
  retailCents?: number | null;
};

export function AddToCart({
  productId,
  slug,
  productName,
  brand,
  variants,
}: {
  productId: string;
  slug: string;
  productName: string;
  brand: string;
  variants: AddToCartVariant[];
}) {
  const router = useRouter();
  const { addLine } = useCart();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [canPurchase, setCanPurchase] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => variants.find((variant) => variant.id === variantId) ?? variants[0],
    [variantId, variants],
  );

  if (!selected) {
    return (
      <p className="text-sm text-teal-800">
        This product has no purchasable variants yet.
      </p>
    );
  }

  const canAdd = selected.unitPriceCents !== null && selected.available > 0 && eligible;

  function handleAdd(goToCart = false) {
    if (
      !canAdd ||
      !selected?.unitPriceCents ||
      !Number.isInteger(quantity) ||
      quantity > selected.available
    )
      return;
    const line: CartLine = {
      variantId: selected.id,
      productId,
      slug,
      productName,
      variantName: selected.name,
      sku: selected.sku,
      brand,
      sizeLabel: selected.sizeLabel,
      scent: selected.scent,
      unitPriceCents: selected.unitPriceCents,
      quantity,
      imageId: selected.imageId,
    };
    addLine(line);
    setMessage(`${selected.name} added to your cart.`);
    if (goToCart) router.push("/cart");
  }

  return (
    <div className="space-y-4">
      <PurchaseCheck onEligibility={setEligible} onPurchase={setCanPurchase} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-teal-950">Choose a size</legend>
        <div className="grid gap-2">
          {variants.map((variant) => {
            const price = variant.unitPriceCents;
            const active = variant.id === selected.id;
            return (
              <label
                key={variant.id}
                className={`flex cursor-pointer items-start justify-between gap-3 rounded-2xl border px-4 py-3 ${
                  active ? "border-teal-700 bg-teal-50" : "border-teal-100 bg-white"
                }`}
              >
                <span>
                  <input
                    type="radio"
                    name="variant"
                    className="sr-only"
                    checked={active}
                    onChange={() => {
                      setVariantId(variant.id);
                      setQuantity(1);
                    }}
                  />
                  <span className="block font-semibold text-teal-950">
                    {variant.name}
                  </span>
                  <span className="block text-xs text-teal-700">
                    SKU {variant.sku}
                    {variant.available > 0
                      ? ` · ${variant.available} in stock`
                      : " · out of stock"}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-base font-semibold text-teal-950">
                    {price ? formatCents(price) : "—"}
                  </span>
                  {variant.retailCents != null &&
                    price != null &&
                    variant.retailCents > price && (
                      <span className="block text-xs text-teal-700">
                        <s>{formatCents(variant.retailCents)}</s> · Save{" "}
                        {formatCents(variant.retailCents - price)}
                      </span>
                    )}
                  {variant.subscriptionCents ? (
                    <span className="block text-xs text-teal-700">
                      Subscribe {formatCents(variant.subscriptionCents)}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-teal-950" htmlFor="qty">
          Qty
        </label>
        <input
          id="qty"
          type="number"
          min={1}
          max={Math.max(1, selected.available)}
          value={quantity}
          onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
          className="h-11 w-20 rounded-2xl border border-teal-200 px-3 text-sm"
        />
        <Button type="button" disabled={!canAdd} onClick={() => handleAdd(false)}>
          Add to cart
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canAdd || !canPurchase}
          onClick={() => {
            handleAdd(false);
            router.push("/checkout");
          }}
          title="Ordering opens after payment, tax and delivery reservations pass testing."
        >
          Buy it now
        </Button>
      </div>
      <p className="text-xs text-teal-700">
        Account approval, validated address, stock and delivery capacity will be rechecked
        before payment. No payment or reservation is made here.
      </p>
      {message ? <p className="text-sm font-medium text-teal-800">{message}</p> : null}
    </div>
  );
}
