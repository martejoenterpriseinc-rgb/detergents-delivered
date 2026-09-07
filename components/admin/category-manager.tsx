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

type Category = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isActive: boolean;
};

export function CategoryManager({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onCreate(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      await adminFetch("/api/categories", {
        method: "POST",
        body: JSON.stringify({
          name: String(formData.get("name") ?? ""),
          slug: String(formData.get("slug") ?? "") || undefined,
          description: String(formData.get("description") ?? "") || undefined,
          parentId: String(formData.get("parentId") ?? "") || undefined,
        }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save category");
    } finally {
      setPending(false);
    }
  }

  async function toggle(category: Category) {
    setError(null);
    try {
      await adminFetch(`/api/categories/${category.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !category.isActive }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update category");
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this category?")) return;
    setError(null);
    try {
      await adminFetch(`/api/categories/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete category");
    }
  }

  const roots = categories.filter((category) => !category.parentId);

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold text-teal-950">Add category</h2>
        <form action={onCreate} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input name="name" required placeholder="Laundry" />
          </Field>
          <Field label="Slug" hint="Leave blank to generate">
            <Input name="slug" placeholder="laundry" />
          </Field>
          <Field label="Parent">
            <Select name="parentId" defaultValue="">
              <option value="">Top level</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <Textarea name="description" rows={2} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save category"}
            </Button>
          </div>
        </form>
      </Card>
      {error ? <p className="text-sm text-amber-800">{error}</p> : null}
      <div className="space-y-3">
        {roots.map((root) => (
          <Card key={root.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-teal-950">{root.name}</p>
                <p className="text-xs text-teal-700">/{root.slug}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => toggle(root)}>
                  {root.isActive ? "Active" : "Hidden"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => remove(root.id)}>
                  Remove
                </Button>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {categories
                .filter((child) => child.parentId === root.id)
                .map((child) => (
                  <li
                    key={child.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-teal-50 px-3 py-2"
                  >
                    <span className="text-sm text-teal-900">{child.name}</span>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => toggle(child)}>
                        {child.isActive ? "Active" : "Hidden"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => remove(child.id)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
