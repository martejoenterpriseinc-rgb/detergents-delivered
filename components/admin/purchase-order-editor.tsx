"use client";

import Link from "next/link";
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

type Vendor = { id: string; name: string };
type Variant = { id: string; sku: string; name: string; product: { name: string } };
type Item = {
  id: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCostCents: number;
  lineTotalCents: number;
  productVariant: { sku: string; name: string; product: { name: string } };
};
type PurchaseOrder = {
  id: string;
  number: string;
  status: string;
  vendorId: string;
  freightCents: number;
  feeCents: number;
  taxCents: number;
  otherCostCents: number;
  subtotalCents: number;
  landedCostCents: number;
  notes: string | null;
  items: Item[];
};

export function PurchaseOrderEditor({
  vendors,
  variants,
  purchaseOrder,
}: {
  vendors: Vendor[];
  variants: Variant[];
  purchaseOrder?: PurchaseOrder;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function createPo(formData: FormData) {
    setError(null);
    try {
      const created = await adminFetch<{ purchaseOrder: { id: string } }>(
        "/api/purchase-orders",
        {
          method: "POST",
          body: JSON.stringify({
            vendorId: String(formData.get("vendorId") ?? ""),
            freightCents: dollarsToCents(String(formData.get("freight") ?? "0")),
            feeCents: dollarsToCents(String(formData.get("fees") ?? "0")),
            taxCents: dollarsToCents(String(formData.get("tax") ?? "0")),
            otherCostCents: dollarsToCents(String(formData.get("other") ?? "0")),
            notes: String(formData.get("notes") ?? "") || null,
          }),
        },
      );
      router.push(`/admin/purchase-orders/${created.purchaseOrder.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create PO");
    }
  }

  async function addLine(formData: FormData) {
    if (!purchaseOrder) return;
    setError(null);
    try {
      await adminFetch(`/api/purchase-orders/${purchaseOrder.id}/items`, {
        method: "POST",
        body: JSON.stringify({
          productVariantId: String(formData.get("productVariantId") ?? ""),
          quantityOrdered: Number(formData.get("quantityOrdered") || 0),
          unitCostCents: dollarsToCents(String(formData.get("unitCost") ?? "0")),
          discountCents: dollarsToCents(String(formData.get("discount") ?? "0")),
        }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add line");
    }
  }

  async function mark(status: "ORDERED" | "CANCELLED") {
    if (!purchaseOrder) return;
    setError(null);
    try {
      await adminFetch(`/api/purchase-orders/${purchaseOrder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status");
    }
  }

  if (!purchaseOrder) {
    return (
      <form action={createPo} className="space-y-4">
        {error ? (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error}
          </p>
        ) : null}
        <Card className="grid gap-4 sm:grid-cols-2">
          <div>
            <Link
              href="/admin/vendors/new"
              target="_blank"
              rel="noopener noreferrer"
              className="mb-2 block underline"
            >
              + Vendor (opens a new tab)
            </Link>
            <button
              type="button"
              className="mb-2 underline"
              onClick={() => router.refresh()}
            >
              Refresh vendor list
            </button>
            <Field label="Vendor">
              <Select name="vendorId" required defaultValue="">
                <option value="" disabled>
                  Choose vendor
                </option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Freight">
            <Input name="freight" placeholder="0.00" />
          </Field>
          <Field label="Fees">
            <Input name="fees" placeholder="0.00" />
          </Field>
          <Field label="Tax">
            <Input name="tax" placeholder="0.00" />
          </Field>
          <Field label="Other">
            <Input name="other" placeholder="0.00" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea name="notes" />
            </Field>
          </div>
          <div>
            <Button type="submit">Create draft PO</Button>
          </div>
        </Card>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-teal-700">{purchaseOrder.number}</p>
          <p className="text-xl font-semibold text-teal-950">{purchaseOrder.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {purchaseOrder.status === "DRAFT" ? (
            <Button type="button" onClick={() => mark("ORDERED")}>
              Mark ordered
            </Button>
          ) : null}
          {purchaseOrder.status !== "RECEIVED" && purchaseOrder.status !== "CANCELLED" ? (
            <Button type="button" variant="outline" onClick={() => mark("CANCELLED")}>
              Cancel
            </Button>
          ) : null}
        </div>
      </Card>
      <Card>
        <p className="text-sm text-teal-800">
          Merchandise {formatCents(purchaseOrder.subtotalCents)} · landed{" "}
          {formatCents(purchaseOrder.landedCostCents)}
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs text-teal-700 uppercase">
              <tr>
                <th className="py-2">SKU</th>
                <th className="py-2">Ordered</th>
                <th className="py-2">Received</th>
                <th className="py-2">Unit</th>
                <th className="py-2">Line</th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrder.items.map((item) => (
                <tr key={item.id} className="border-t border-teal-50">
                  <td className="py-2">
                    {item.productVariant.sku}
                    <div className="text-xs text-teal-700">
                      {item.productVariant.product.name}
                    </div>
                  </td>
                  <td className="py-2">{item.quantityOrdered}</td>
                  <td className="py-2">{item.quantityReceived}</td>
                  <td className="py-2">{formatCents(item.unitCostCents)}</td>
                  <td className="py-2">{formatCents(item.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {purchaseOrder.status === "DRAFT" ? (
        <Card>
          <h2 className="text-lg font-semibold text-teal-950">Add line</h2>
          <form action={addLine} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Variant">
              <Select name="productVariantId" required defaultValue="">
                <option value="" disabled>
                  Choose SKU
                </option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku} — {variant.product.name} {variant.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Qty">
              <Input
                name="quantityOrdered"
                type="number"
                min={1}
                required
                defaultValue={1}
              />
            </Field>
            <Field label="Unit cost">
              <Input name="unitCost" placeholder="8.50" required />
            </Field>
            <Field label="Discount">
              <Input name="discount" placeholder="0.00" />
            </Field>
            <div>
              <Button type="submit" variant="secondary">
                Add line
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
