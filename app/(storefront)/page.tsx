import { getPublishedHomePage } from "@/lib/services/site-content";
import { publicSiteDocument } from "@/lib/domain/site-content";
import { featuredHomeProducts } from "@/lib/services/storefront-home";
import { getDeliveryCoverage } from "@/lib/services/delivery-coverage";
import { StorefrontHome } from "@/components/storefront/home";
export const dynamic = "force-dynamic";
export default async function HomePage() {
  const [{ page }, products, coverage] = await Promise.all([
    getPublishedHomePage(),
    featuredHomeProducts(),
    getDeliveryCoverage(),
  ]);
  return (
    <StorefrontHome
      document={publicSiteDocument(page)}
      products={products}
      coverage={coverage}
    />
  );
}
