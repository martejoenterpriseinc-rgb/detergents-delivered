"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/admin/field";
import { adminFetch, dollarsToCents } from "@/lib/admin-fetch";
import { formatCents } from "@/lib/domain/money";

type Category = { id: string; name: string; parentId: string | null };
type Price = { id: string; kind: string; amountCents: number; startsAt: string | Date };
type Variant = {
  id: string;
  sku: string;
  upc: string | null;
  name: string;
  scent: string | null;
  sizeLabel: string | null;
  uom: string | null;
  casePack: number | null;
  reorderPoint: number | null;
  reorderQty: number | null;
  isActive: boolean;
  websiteVisible: boolean;
  prices: Price[];
  inventoryBalance: { onHandQty: number; reservedQty: number } | null;
  costLayers: { quantityRemaining: number; landedUnitCostCents: number }[];
};
type Product = {
  id: string;
  name: string;
  brand: string;
  slug: string;
  description: string | null;
  categoryId: string | null;
  form: string;
  taxCategory: string | null;
  deliveryCapacityUnits: number;
  allowPreorder: boolean;
  isActive: boolean;
  websiteVisible: boolean;
  featured: boolean;
  variants: Variant[];
};

export function ProductEditor({
  product,
  categories,
}: {
  product?: Product;
  categories: Category[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function saveProduct(formData: FormData) {
    setPending(true);
    setError(null);
    const payload = {
      name: String(formData.get("name") ?? ""),
      brand: String(formData.get("brand") ?? ""),
      slug: String(formData.get("slug") ?? "") || undefined,
      description: String(formData.get("description") ?? "") || undefined,
      categoryId: String(formData.get("categoryId") ?? "") || undefined,
      form: String(formData.get("form") ?? "OTHER"),
      taxCategory: String(formData.get("taxCategory") ?? "") || undefined,
      deliveryCapacityUnits: Number(formData.get("deliveryCapacityUnits") || 1),
      allowPreorder: formData.get("allowPreorder") === "on",
      isActive: formData.get("isActive") === "on",
      websiteVisible: formData.get("websiteVisible") === "on",
      featured: formData.get("featured") === "on",
    };
    try {
      if (product) {
        await adminFetch(`/api/products/${product.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        router.refresh();
      } else {
        const created = await adminFetch<{ product: { id: string } }>("/api/products", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        router.push(`/admin/products/${created.product.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save product");
    } finally {
      setPending(false);
    }
  }

  async function addVariant(formData: FormData) {
    if (!product) return;
    setError(null);
    try {
      await adminFetch(`/api/products/${product.id}/variants`, {
        method: "POST",
        body: JSON.stringify({
          sku: String(formData.get("sku") ?? ""),
          name: String(formData.get("variantName") ?? ""),
          upc: String(formData.get("upc") ?? "") || null,
          scent: String(formData.get("scent") ?? "") || null,
          sizeLabel: String(formData.get("sizeLabel") ?? "") || null,
          uom: String(formData.get("uom") ?? "") || null,
          casePack: Number(formData.get("casePack") || 0) || null,
          reorderPoint: Number(formData.get("reorderPoint") || 0) || null,
          reorderQty: Number(formData.get("reorderQty") || 0) || null,
        }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add variant");
    }
  }

  async function addPrice(variantId: string, formData: FormData) {
    setError(null);
    try {
      await adminFetch(`/api/variants/${variantId}/prices`, {
        method: "POST",
        body: JSON.stringify({
          kind: String(formData.get("kind") ?? "RETAIL"),
          amountCents: dollarsToCents(String(formData.get("amount") ?? "0")),
        }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add price");
    }
  }

  async function uploadImage(formData: FormData) {
    if (!product) return;
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    setError(null);
    try {
      const upload = new FormData();
      upload.set("file", file);
      const stored = await fetch("/api/uploads", { method: "POST", body: upload }).then(
        (res) => res.json(),
      );
      if (!stored.storageKey) throw new Error(stored.error || "upload failed");
      await adminFetch(`/api/products/${product.id}/images`, {
        method: "POST",
        body: JSON.stringify({
          storageKey: stored.storageKey,
          alt: product.name,
          isPrimary: true,
        }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload image");
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}
      <form action={saveProduct} className="space-y-6">
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-teal-950">Basics</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                name="name"
                required
                defaultValue={product?.name}
                placeholder="Liquid Detergent · Lavender · 100 oz"
              />
            </Field>
            <Field label="Brand">
              <Input
                name="brand"
                required
                defaultValue={product?.brand}
                placeholder="Generic"
              />
            </Field>
            <Field label="Category">
              <Select name="categoryId" defaultValue={product?.categoryId ?? ""}>
                <option value="">Uncategorized</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Form">
              <Select name="form" defaultValue={product?.form ?? "LIQUID"}>
                <option value="LIQUID">Liquid</option>
                <option value="POWDER">Powder</option>
                <option value="PODS">Pods</option>
                <option value="SHEETS">Sheets</option>
                <option value="OTHER">Other</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <Textarea name="description" defaultValue={product?.description ?? ""} />
              </Field>
            </div>
          </div>
        </Card>
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-teal-950">Website & tax</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-teal-900">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={product?.isActive ?? true}
              />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm text-teal-900">
              <input
                type="checkbox"
                name="websiteVisible"
                defaultChecked={product?.websiteVisible ?? false}
              />
              Visible on website
            </label>
            <label className="flex items-center gap-2 text-sm text-teal-900">
              <input
                type="checkbox"
                name="featured"
                defaultChecked={product?.featured ?? false}
              />
              Featured
            </label>
            <label className="flex items-center gap-2 text-sm text-teal-900">
              <input
                type="checkbox"
                name="allowPreorder"
                defaultChecked={product?.allowPreorder ?? false}
              />
              Allow preorder (show at 0 stock)
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Tax category">
              <Input
                name="taxCategory"
                defaultValue={product?.taxCategory ?? ""}
                placeholder="TAXABLE"
              />
            </Field>
            <Field label="Delivery capacity units">
              <Input
                name="deliveryCapacityUnits"
                type="number"
                min={0}
                defaultValue={product?.deliveryCapacityUnits ?? 1}
              />
            </Field>
            <Field label="Slug">
              <Input name="slug" defaultValue={product?.slug} />
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : product ? "Save product" : "Create product"}
          </Button>
        </Card>
      </form>

      {product ? (
        <>
          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-teal-950">Image</h2>
            <p className="text-sm text-teal-800">
              Stored as an object key (local stub in development). Private assets are
              never given public unsigned URLs.
            </p>
            <form
              action={uploadImage}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <Field label="File">
                <Input name="file" type="file" accept="image/*" />
              </Field>
              <Button type="submit" variant="secondary">
                Upload
              </Button>
            </form>
          </Card>
          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-teal-950">Variants</h2>
            <p className="text-sm text-teal-800">
              Scent, size, and form live on the variant so you do not duplicate the
              product.
            </p>
            <div className="space-y-4">
              {product.variants.map((variant) => {
                const onHand = variant.inventoryBalance?.onHandQty ?? 0;
                const reserved = variant.inventoryBalance?.reservedQty ?? 0;
                const layerValue = variant.costLayers.reduce(
                  (sum, layer) =>
                    sum + layer.quantityRemaining * layer.landedUnitCostCents,
                  0,
                );
                const remaining = variant.costLayers.reduce(
                  (sum, layer) => sum + layer.quantityRemaining,
                  0,
                );
                const landed = remaining > 0 ? Math.round(layerValue / remaining) : null;
                return (
                  <div
                    key={variant.id}
                    className="rounded-2xl border border-teal-100 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-teal-950">{variant.name}</p>
                        <p className="text-xs text-teal-700">
                          SKU {variant.sku}
                          {variant.upc ? ` · UPC ${variant.upc}` : ""}
                          {variant.sizeLabel ? ` · ${variant.sizeLabel}` : ""}
                          {variant.scent ? ` · ${variant.scent}` : ""}
                        </p>
                      </div>
                      <p className="text-xs text-teal-700">
                        On hand {onHand} · reserved {reserved}
                        {landed !== null ? ` · landed ${formatCents(landed)}` : ""}
                      </p>
                    </div>
                    <ul className="mt-3 text-sm text-teal-800">
                      {variant.prices.slice(0, 4).map((price) => (
                        <li key={price.id}>
                          {price.kind}: {formatCents(price.amountCents)} from{" "}
                          {new Date(price.startsAt).toLocaleDateString()}
                        </li>
                      ))}
                    </ul>
                    <form
                      action={(formData) => addPrice(variant.id, formData)}
                      className="mt-3 grid gap-3 sm:grid-cols-3"
                    >
                      <Select name="kind" defaultValue="RETAIL">
                        <option value="RETAIL">Retail</option>
                        <option value="SUBSCRIPTION">Subscription</option>
                        <option value="SALE">Sale</option>
                      </Select>
                      <Input name="amount" placeholder="12.99" required />
                      <Button type="submit" variant="secondary" size="sm">
                        New price row
                      </Button>
                    </form>
                  </div>
                );
              })}
            </div>
            <form action={addVariant} className="grid gap-4 sm:grid-cols-2">
              <Field label="SKU">
                <Input name="sku" required placeholder="DD-LIQ-64-FRESH" />
              </Field>
              <Field label="Variant name">
                <Input
                  name="variantName"
                  required
                  placeholder="Liquid Detergent · Fresh · 64 oz"
                />
              </Field>
              <Field label="UPC / barcode">
                <Input name="upc" inputMode="numeric" />
              </Field>
              <Field label="Scent">
                <Input name="scent" />
              </Field>
              <Field label="Size">
                <Input name="sizeLabel" placeholder="64 oz" />
              </Field>
              <Field label="UOM">
                <Input name="uom" placeholder="bottle" />
              </Field>
              <Field label="Case pack">
                <Input name="casePack" type="number" min={0} />
              </Field>
              <Field label="Reorder point">
                <Input name="reorderPoint" type="number" min={0} />
              </Field>
              <Field label="Reorder qty">
                <Input name="reorderQty" type="number" min={0} />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" variant="outline">
                  Add variant
                </Button>
              </div>
            </form>
          </Card>
        </>
      ) : null}
    </div>
  );
}
