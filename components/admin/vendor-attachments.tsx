"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/admin/field";
import { adminFetch } from "@/lib/admin-fetch";

type Attachment = { id: string; filename: string; storageKey: string; notes: string | null };

export function VendorAttachments({
  vendorId,
  attachments,
}: {
  vendorId: string;
  attachments: Attachment[];
}) {
  const router = useRouter();

  async function onSubmit(formData: FormData) {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    const upload = new FormData();
    upload.set("file", file);
    const stored = await fetch("/api/uploads", { method: "POST", body: upload }).then((res) =>
      res.json(),
    );
    await adminFetch("/api/attachments", {
      method: "POST",
      body: JSON.stringify({
        entityType: "VENDOR",
        entityId: vendorId,
        storageKey: stored.storageKey,
        filename: stored.filename,
        contentType: stored.contentType,
        byteSize: stored.byteSize,
        notes: String(formData.get("notes") ?? "") || undefined,
      }),
    });
    router.refresh();
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold text-teal-950">Attachments</h2>
      <p className="text-sm text-teal-800">
        Metadata only — files stay behind object-storage keys, not public URLs.
      </p>
      <ul className="text-sm text-teal-800">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            {attachment.filename} · {attachment.storageKey}
            {attachment.notes ? ` — ${attachment.notes}` : ""}
          </li>
        ))}
        {attachments.length === 0 ? <li>No files yet.</li> : null}
      </ul>
      <form action={onSubmit} className="grid gap-3 sm:grid-cols-2">
        <Field label="File">
          <Input name="file" type="file" />
        </Field>
        <Field label="Notes">
          <Input name="notes" placeholder="W-9, insurance, terms" />
        </Field>
        <div>
          <Button type="submit" variant="secondary">
            Attach
          </Button>
        </div>
      </form>
    </Card>
  );
}
