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
  const { page, counties } = await getHomePageForBuilder();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-teal-950">Website</h1>
          <p className="mt-2 max-w-2xl text-sm text-teal-800">
            Edit storefront sections and publish them. This is a section-based click-to-edit
            builder, not a drag-and-drop visual designer. Chicagoland counties stay in Settings.
          </p>
        </div>
        <Link href={"/admin/website/builder" as Route}>
          <Button>Open builder</Button>
        </Link>
      </div>
      <Card className="space-y-2">
        <p className="text-sm font-semibold text-teal-950">Home page</p>
        <p className="text-sm text-teal-800">
          {page.sections.length} sections · {page.sections.filter((section) => section.visible).length}{" "}
          visible on the storefront. Last updated {page.updatedAt.toISOString().slice(0, 10)}.
        </p>
      </Card>
      <Card className="space-y-3">
        <p className="text-sm font-semibold text-teal-950">Service counties</p>
        <p className="text-sm text-teal-800">
          Weekly scheduled delivery uses the enabled Chicagoland counties from Settings. The home
          page ZIP checker reads the same list.
        </p>
        <p className="text-sm text-teal-900">{counties.join(", ") || "None enabled"}</p>
        <Link href={"/admin/settings" as Route}>
          <Button variant="outline">Edit counties in Settings</Button>
        </Link>
      </Card>
    </div>
  );
}
