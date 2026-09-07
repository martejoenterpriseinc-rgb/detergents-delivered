import Link from "next/link";
import type { Route } from "next";
import { WebsiteBuilder } from "@/components/admin/website-builder";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/authz";
import { WEBSITE_MANAGER_ROLES } from "@/lib/domain/site-content";
import { getHomePageForBuilder } from "@/lib/services/site-content";

export const dynamic = "force-dynamic";

export default async function WebsiteBuilderPage() {
  await requireRole(...WEBSITE_MANAGER_ROLES);
  const { page, counties } = await getHomePageForBuilder();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
            <Link href={"/admin/website" as Route} className="hover:text-teal-950">
              Website
            </Link>
            {" / "}
            Builder
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-teal-950">Home builder</h1>
          <p className="mt-2 max-w-2xl text-sm text-teal-800">
            Click a section in the preview, edit copy and actions, then save to publish. Hidden
            sections stay in the database but do not appear on the storefront.
          </p>
        </div>
        <Link href={"/" as Route} target="_blank">
          <Button variant="outline">View storefront</Button>
        </Link>
      </div>
      <WebsiteBuilder
        initialSections={page.sections.map((section) => ({
          sectionId: section.sectionId,
          type: section.type,
          title: section.title,
          body: section.body,
          badgeText: section.badgeText,
          ctaLabel: section.ctaLabel,
          ctaHref: section.ctaHref,
          secondaryCtaLabel: section.secondaryCtaLabel,
          secondaryCtaHref: section.secondaryCtaHref,
          visible: section.visible,
          sortOrder: section.sortOrder,
          styleVariant: section.styleVariant,
          intentNotes: section.intentNotes,
        }))}
        counties={counties}
      />
    </div>
  );
}
