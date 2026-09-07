"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/admin/field";
import { adminFetch } from "@/lib/admin-fetch";

type Vendor = {
  id?: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export function VendorEditor({ vendor }: { vendor?: Vendor }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const payload = {
      name: String(formData.get("name") ?? ""),
      contactName: String(formData.get("contactName") ?? "") || null,
      email: String(formData.get("email") ?? "") || null,
      phone: String(formData.get("phone") ?? "") || null,
      addressLine1: String(formData.get("addressLine1") ?? "") || null,
      addressLine2: String(formData.get("addressLine2") ?? "") || null,
      city: String(formData.get("city") ?? "") || null,
      region: String(formData.get("region") ?? "") || null,
      postalCode: String(formData.get("postalCode") ?? "") || null,
      country: String(formData.get("country") ?? "US") || "US",
      paymentTerms: String(formData.get("paymentTerms") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
      isActive: formData.get("isActive") === "on",
    };
    try {
      if (vendor?.id) {
        await adminFetch(`/api/vendors/${vendor.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        router.refresh();
      } else {
        const created = await adminFetch<{ vendor: { id: string } }>("/api/vendors", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        router.push(`/admin/vendors/${created.vendor.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save vendor");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="space-y-6">
      {error ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p>
      ) : null}
      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor name">
          <Input name="name" required defaultValue={vendor?.name} />
        </Field>
        <Field label="Contact">
          <Input name="contactName" defaultValue={vendor?.contactName ?? ""} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" defaultValue={vendor?.email ?? ""} />
        </Field>
        <Field label="Phone">
          <Input name="phone" defaultValue={vendor?.phone ?? ""} />
        </Field>
        <Field label="Payment terms">
          <Input name="paymentTerms" defaultValue={vendor?.paymentTerms ?? ""} placeholder="Net 30" />
        </Field>
        <label className="flex items-center gap-2 self-end text-sm text-teal-900">
          <input type="checkbox" name="isActive" defaultChecked={vendor?.isActive ?? true} />
          Active
        </label>
        <Field label="Address">
          <Input name="addressLine1" defaultValue={vendor?.addressLine1 ?? ""} />
        </Field>
        <Field label="Address 2">
          <Input name="addressLine2" defaultValue={vendor?.addressLine2 ?? ""} />
        </Field>
        <Field label="City">
          <Input name="city" defaultValue={vendor?.city ?? ""} />
        </Field>
        <Field label="Region">
          <Input name="region" defaultValue={vendor?.region ?? ""} />
        </Field>
        <Field label="Postal code">
          <Input name="postalCode" defaultValue={vendor?.postalCode ?? ""} />
        </Field>
        <Field label="Country">
          <Input name="country" defaultValue={vendor?.country ?? "US"} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <Textarea name="notes" defaultValue={vendor?.notes ?? ""} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : vendor?.id ? "Save vendor" : "Create vendor"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
