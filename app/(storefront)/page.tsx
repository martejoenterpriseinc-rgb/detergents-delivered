import Link from "next/link";
import type { Route } from "next";
import { Droplets, MapPinned, Package, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeliveryChecker } from "@/components/storefront/delivery-checker";
import { ProductCard } from "@/components/storefront/product-card";
import { listFeaturedShopProducts } from "@/lib/catalog-public";
import type { SiteSectionDraft } from "@/lib/domain/site-content";
import { getPublicDeliveryInfo } from "@/lib/services/delivery-settings";
import { getPublishedHomePage } from "@/lib/services/site-content";

export const dynamic = "force-dynamic";

const VALUE_ICONS = [Truck, Droplets, Package] as const;

function pickSection(sections: SiteSectionDraft[], sectionId: string) {
  return sections.find((section) => section.sectionId === sectionId);
}

export default async function HomePage() {
  const [{ page }, featured, delivery] = await Promise.all([
    getPublishedHomePage(),
    listFeaturedShopProducts(4),
    getPublicDeliveryInfo(),
  ]);
  const hero = pickSection(page.sections, "hero");
  const porch = pickSection(page.sections, "porch-checker");
  const valueProps = page.sections.filter((section) =>
    section.sectionId.startsWith("value-"),
  );
  const featuredSection = pickSection(page.sections, "featured");
  const howItWorks = pickSection(page.sections, "how-it-works");
  const stepTitles = (howItWorks?.body ?? "Check your ZIP\nFill the cart\nWe bring it by")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const steps = [
    {
      title: stepTitles[0] ?? "Check your ZIP",
      body: delivery.serviceAreaSummary,
    },
    {
      title: stepTitles[1] ?? "Fill the cart",
      body: "Pick sizes, scents, and types from the live catalog — the same stock we receive in the warehouse.",
    },
    {
      title: stepTitles[2] ?? "We bring it by",
      body: `${delivery.weeklySummary} ${delivery.noSameDaySummary}${
        delivery.nextWindowLabel ? ` Next window: ${delivery.nextWindowLabel}.` : ""
      }`,
    },
  ];

  return (
    <div>
      <section className="to-background bg-gradient-to-b from-teal-50">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            {hero?.badgeText ? (
              <p className="text-sm font-semibold tracking-[0.2em] text-teal-700 uppercase">
                {hero.badgeText}
              </p>
            ) : null}
            {hero?.title ? (
              <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-teal-950 sm:text-5xl">
                {hero.title}
              </h1>
            ) : null}
            {hero?.body ? (
              <p className="max-w-xl text-lg leading-8 text-teal-900/80">
                {hero.body} {delivery.weeklySummary}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              {hero?.ctaLabel && hero.ctaHref ? (
                <Link href={hero.ctaHref as Route}>
                  <Button size="lg">{hero.ctaLabel}</Button>
                </Link>
              ) : null}
              {hero?.secondaryCtaLabel && hero.secondaryCtaHref ? (
                <Link href={hero.secondaryCtaHref as Route}>
                  <Button size="lg" variant="outline">
                    {hero.secondaryCtaLabel}
                  </Button>
                </Link>
              ) : null}
            </div>
          </div>
          {porch ? (
            <Card className="space-y-4 bg-white">
              <div className="flex items-center gap-3">
                <MapPinned className="h-6 w-6 text-teal-700" aria-hidden />
                <div>
                  <p className="font-semibold text-teal-950">{porch.title}</p>
                  <p className="text-sm text-teal-800">
                    {porch.body} Currently {delivery.countyListLabel}. Try{" "}
                    {delivery.exampleZip}.
                  </p>
                </div>
              </div>
              <DeliveryChecker
                compact
                config={{
                  enabledCountyCodes: delivery.enabledCountyCodes,
                  nextWindowLabel: delivery.nextWindowLabel,
                  exampleZip: delivery.exampleZip,
                  exampleZips: delivery.exampleZips,
                }}
              />
            </Card>
          ) : null}
        </div>
      </section>

      {valueProps.length > 0 ? (
        <section className="mx-auto w-full max-w-6xl px-4 py-12">
          <div className="grid gap-4 md:grid-cols-3">
            {valueProps.map((prop, index) => {
              const Icon = VALUE_ICONS[index] ?? Package;
              return (
                <Card key={prop.sectionId} className="space-y-3">
                  <Icon className="h-6 w-6 text-teal-700" aria-hidden />
                  <h2 className="text-lg font-semibold text-teal-950">{prop.title}</h2>
                  <p className="text-sm leading-6 text-teal-800">{prop.body}</p>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {featuredSection ? (
        <section className="mx-auto w-full max-w-6xl px-4 pb-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-teal-950">{featuredSection.title}</h2>
              {featuredSection.body ? (
                <p className="mt-1 text-sm text-teal-800">{featuredSection.body}</p>
              ) : null}
            </div>
            {featuredSection.ctaLabel && featuredSection.ctaHref ? (
              <Link
                href={featuredSection.ctaHref as Route}
                className="text-sm font-semibold text-teal-800 hover:text-teal-950"
              >
                {featuredSection.ctaLabel}
              </Link>
            ) : null}
          </div>
          {featured.length === 0 ? (
            <Card className="mt-6">
              <p className="font-medium text-teal-950">Catalog is warming up</p>
              <p className="mt-2 text-sm text-teal-800">
                Set <code>DEMO_MODE=true</code> or <code>SEED_DEMO_CATALOG=true</code> and
                restart, or publish products in admin.
              </p>
            </Card>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {howItWorks ? (
        <section className="bg-teal-950 text-teal-50">
          <div className="mx-auto w-full max-w-6xl px-4 py-12">
            <h2 className="text-2xl font-semibold">{howItWorks.title}</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {steps.map((step, index) => (
                <div key={step.title} className="rounded-3xl bg-teal-900/60 p-5">
                  <p className="text-xs font-semibold tracking-[0.2em] text-teal-300 uppercase">
                    Step {index + 1}
                  </p>
                  <p className="mt-2 text-lg font-semibold">{step.title}</p>
                  <p className="mt-2 text-sm leading-6 text-teal-100/80">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
