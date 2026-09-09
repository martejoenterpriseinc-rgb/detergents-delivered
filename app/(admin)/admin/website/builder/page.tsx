import { WebsiteBuilder } from "@/components/admin/website-builder";
import { requireRole } from "@/lib/authz";
import { WEBSITE_MANAGER_ROLES } from "@/lib/domain/site-content";
import { getHomePageForBuilder } from "@/lib/services/site-content";
export const dynamic = "force-dynamic";
export default async function WebsiteBuilderPage() {
  await requireRole(...WEBSITE_MANAGER_ROLES);
  const { page, draft } = await getHomePageForBuilder();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold tracking-wide text-teal-700 uppercase">
          Website / Builder
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-teal-950">
          Your storefront, your way
        </h1>
        <p className="mt-2 text-sm text-teal-800">
          Select an area, update its content or photos, and save to apply. Preview the
          same page your customers see on each device.
        </p>
      </div>
      <WebsiteBuilder
        initialDocument={draft ?? { sections: page.sections, settings: page.settings }}
        initialVersion={page.version}
        hasDraft={Boolean(draft)}
      />
    </div>
  );
}
