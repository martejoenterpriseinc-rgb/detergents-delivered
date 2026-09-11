import { listFeaturedShopProducts } from "@/lib/catalog-public";
import { launchConfig } from "@/lib/services/launch";
import { runtimeCommerceConfiguration } from "@/lib/commerce/runtime";
import { businessDate } from "@/lib/domain/operations";
export async function storefrontLaunchNotice() {
  const launch = await launchConfig();
  return launch.enabled &&
    businessDate() <= launch.cutoffDate &&
    !(await runtimeCommerceConfiguration()).enabled
    ? `Planned launch: ${launch.launchDate}. First delivery window: ${launch.launchDate}–${launch.firstDeliveryBy}. Ordering is not open yet.`
    : "";
}
export async function featuredHomeProducts() {
  // Public DTO: never serialize supplier costs, inventory ledgers or internal catalog fields.
  return (await listFeaturedShopProducts()).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    form: p.form,
    images: p.images.map((i) => ({ id: i.id })),
    variants: p.variants.map((v) => ({
      available: v.available,
      salePrice: v.salePrice ? { amountCents: v.salePrice.amountCents } : null,
      retailPrice: v.retailPrice ? { amountCents: v.retailPrice.amountCents } : null,
      images: v.images.map((i) => ({ id: i.id })),
    })),
  }));
}
