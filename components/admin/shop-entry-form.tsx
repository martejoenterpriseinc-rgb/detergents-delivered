"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { dollarsToCents } from "@/lib/domain/loyalty";
import { formatCents } from "@/lib/domain/money";
import { Input } from "@/components/ui/input";
import { Field } from "./field";
export function ShopEntryForm({ imageReady }: { imageReady: boolean }) {
  const router = useRouter();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [price, setPrice] = useState("");
  const [retail, setRetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let saving = 0;
  try {
    saving = Math.max(0, dollarsToCents(retail) - dollarsToCents(price));
  } catch {}
  return (
    <form
      className="space-y-5 rounded-3xl border border-teal-100 bg-white p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const form = new FormData(e.currentTarget);
          form.set(
            "details",
            JSON.stringify({
              title: form.get("title"),
              description: form.get("description"),
              sku: form.get("sku"),
              priceCents: dollarsToCents(price),
              retailCents: dollarsToCents(retail),
              loadKind: form.get("loadKind"),
              deliveryCapacityUnits: Number(form.get("deliveryCapacityUnits")),
              publish: form.get("publish") === "on",
              requestKey,
            }),
          );
          const response = await fetch("/api/admin/shop", { method: "POST", body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          router.push(`/admin/products/${result.id}`);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Product save could not be confirmed.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <Field label="Title">
          <Input name="title" required maxLength={160} />
        </Field>
        <Field label="SKU">
          <Input name="sku" required maxLength={80} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea
              name="description"
              required
              maxLength={5000}
              rows={4}
              className="w-full rounded-2xl border border-teal-200 p-3"
            />
          </Field>
        </div>
        <Field label="Selling price ($)">
          <Input
            inputMode="decimal"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label="Regular retail price ($)">
          <Input
            inputMode="decimal"
            required
            value={retail}
            onChange={(e) => setRetail(e.target.value)}
          />
        </Field>
        <p className="rounded-xl bg-teal-50 p-3 font-semibold sm:col-span-2">
          Customer saves {formatCents(saving)} per item
        </p>
        <Field label="Vehicle load type">
          <select
            name="loadKind"
            className="h-11 w-full rounded-xl border border-teal-200 px-3"
          >
            <option value="DETERGENT">Detergent bucket</option>
            <option value="SCENT_BEADS">Scent beads bucket</option>
            <option value="OTHER">Other product</option>
          </select>
        </Field>
        <Field label="Vehicle space units per item">
          <Input
            name="deliveryCapacityUnits"
            type="number"
            min={1}
            max={1000}
            defaultValue={1}
            required
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Product image (JPEG or PNG, up to 4 MB)">
            <input
              name="image"
              type="file"
              accept="image/jpeg,image/png"
              disabled={!imageReady}
            />
          </Field>
          {!imageReady && (
            <p className="mt-2 text-sm text-amber-900">
              Image uploads will be available after durable catalog storage is connected.
              You can save the product details now.
            </p>
          )}
        </div>
        <label className="sm:col-span-2">
          <input name="publish" type="checkbox" /> Publish when received inventory is
          available
        </label>
      </fieldset>
      <p className="text-sm">
        Stock quantities come from Receiving. Use an accurate, supportable retail
        comparison price; the shop calculates savings from the same variant.
      </p>
      {error && (
        <p role="alert" className="text-rose-900">
          {error}
        </p>
      )}
      <button className="ops-button" disabled={busy}>
        {busy ? "Saving…" : "Save inventory product"}
      </button>
    </form>
  );
}
