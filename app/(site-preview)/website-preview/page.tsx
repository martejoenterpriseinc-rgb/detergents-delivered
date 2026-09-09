import { requireRole } from "@/lib/authz";
import { WEBSITE_MANAGER_ROLES } from "@/lib/domain/site-content";
import { getHomePageForBuilder } from "@/lib/services/site-content";
import {
  featuredHomeProducts,
  storefrontLaunchNotice,
} from "@/lib/services/storefront-home";
import { getDeliveryCoverage } from "@/lib/services/delivery-coverage";
import { WebsitePreview } from "@/components/admin/website-preview";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Website preview",
  robots: { index: false, follow: false },
};
export default async function PreviewPage() {
  await requireRole(...WEBSITE_MANAGER_ROLES);
  const [{ page, draft }, products, coverage, launchNotice] = await Promise.all([
    getHomePageForBuilder(),
    featuredHomeProducts(),
    getDeliveryCoverage(),
    storefrontLaunchNotice(),
  ]);
  return (
    <WebsitePreview
      initialDocument={draft ?? { sections: page.sections, settings: page.settings }}
      products={products}
      coverage={coverage}
      launchNotice={launchNotice}
    />
  );
}
