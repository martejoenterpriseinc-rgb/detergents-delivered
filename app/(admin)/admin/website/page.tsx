import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/authz";
import { WEBSITE_MANAGER_ROLES } from "@/lib/domain/site-content";
import { getHomePageForBuilder } from "@/lib/services/site-content";

export const dynamic = "force-dynamic";

export default async function WebsitePage() {
  await requireRole(...WEBSITE_MANAGER_ROLES);
  const { page, draft } = await getHomePageForBuilder();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-teal-950">Website</h1>
          <p className="mt-2 max-w-2xl text-sm text-teal-800">
            Select any home page area to edit its text, photos, buttons and layout.
            Preview the actual storefront on computer, tablet and mobile, then save to
            apply.
          </p>
        </div>
        <Link href={"/admin/website/builder" as Route}>
          <Button>Open builder</Button>
        </Link>
      </div>
      <Link className="ops-button" href="/admin/shop">
        Shop online · Add inventory
      </Link>
      <Card className="space-y-2">
        <p className="text-sm font-semibold text-teal-950">Home page</p>
        <p className="text-sm text-teal-800">
          {page.sections.length} sections ·{" "}
          {page.sections.filter((section) => section.visible).length} visible on the
          storefront. Last updated {page.updatedAt.toISOString().slice(0, 10)}.
        </p>
      </Card>
      <Card className="space-y-3">
        <p className="text-sm font-semibold text-teal-950">Delivery ZIP codes</p>
        <p className="text-sm text-teal-800">
          The map and delivery checker use the active ZIP codes in Launch & capacity.
          Adding or removing an active ZIP updates the customer delivery map
          automatically.
        </p>
        <p className="text-sm text-teal-900">
          {draft
            ? "An unpublished website draft is saved."
            : "The current website version is published."}
        </p>
        <Link href={"/admin/settings/launch" as Route}>
          <Button variant="outline">Edit delivery ZIP codes</Button>
        </Link>
      </Card>
    </div>
  );
}
