"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/admin/field";
import { adminFetch } from "@/lib/admin-fetch";

type VariantOption = { id: string; sku: string; name: string };

export function InventoryAdjustmentForm({ variants }: { variants: VariantOption[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    try {
      await adminFetch("/api/inventory/adjustments", {
        method: "POST",
        body: JSON.stringify({
          productVariantId: String(formData.get("productVariantId") ?? ""),
          quantity: Number(formData.get("quantity") || 0),
          reason: String(formData.get("reason") ?? ""),
          notes: String(formData.get("notes") ?? "") || null,
          type: String(formData.get("type") ?? "ADJUSTMENT"),
          occurredAt: new Date(String(formData.get("occurredAt") || Date.now())).toISOString(),
        }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjustment failed");
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-teal-950">Adjustment / cycle count</h2>
      <p className="mt-1 text-sm text-teal-800">
        Writes a ledger row and audit log. Balances are never overwritten in place.
      </p>
      {error ? <p className="mt-3 text-sm text-amber-800">{error}</p> : null}
      <form action={onSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="SKU">
          <Select name="productVariantId" required defaultValue="">
            <option value="" disabled>
              Choose variant
            </option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.sku} — {variant.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select name="type" defaultValue="ADJUSTMENT">
            <option value="ADJUSTMENT">Adjustment</option>
            <option value="COUNT">Cycle count</option>
            <option value="LOSS">Loss</option>
            <option value="DAMAGE">Damage</option>
          </Select>
        </Field>
        <Field label="Signed qty" hint="Positive adds on-hand for adjustment/count">
          <Input name="quantity" type="number" required />
        </Field>
        <Field label="When">
          <Input
            name="occurredAt"
            type="datetime-local"
            defaultValue={new Date().toISOString().slice(0, 16)}
          />
        </Field>
        <Field label="Reason">
          <Input name="reason" required placeholder="Cycle count variance" />
        </Field>
        <Field label="Notes">
          <Textarea name="notes" />
        </Field>
        <div>
          <Button type="submit">Post to ledger</Button>
        </div>
      </form>
    </Card>
  );
}
