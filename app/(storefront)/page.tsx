import Link from "next/link";
import { Droplets, MapPinned, Package, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeliveryChecker } from "@/components/storefront/delivery-checker";
import { ProductCard } from "@/components/storefront/product-card";
import { listFeaturedShopProducts } from "@/lib/catalog-public";

export const dynamic = "force-dynamic";

const VALUE_PROPS = [
  {
    title: "Delivered to your door",
    body: "Heavy jugs and bulky paper stay in our van. You get a clean stoop and a restocked cabinet.",
    icon: Truck,
  },
  {
    title: "Household staples, not a marketplace",
    body: "Detergent, pods, dish, paper, and everyday cleaners — chosen for regular family use.",
    icon: Droplets,
  },
  {
    title: "Order once or set a rhythm",
    body: "Grab what you need today. Subscriptions will refill the same SKUs on your cadence.",
    icon: Package,
  },
];

const STEPS = [
  {
    title: "Check your ZIP",
    body: "We deliver a defined metro area. Confirm your porch is on a route.",
  },
  {
    title: "Fill the cart",
    body: "Pick sizes and scents from the live catalog — the same stock we receive in the warehouse.",
  },
  {
    title: "We bring it by",
    body: "A local driver drops the order at your door. No warehouse-club parking lot.",
  },
];

export default async function HomePage() {
  const featured = await listFeaturedShopProducts(4);

  return (
    <div>
      <section className="to-background bg-gradient-to-b from-teal-50">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <p className="text-sm font-semibold tracking-[0.2em] text-teal-700 uppercase">
              Local household delivery
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-teal-950 sm:text-5xl">
              Detergent and everyday clean — delivered to your door.
            </h1>
            <p className="max-w-xl text-lg leading-8 text-teal-900/80">
              Detergents Delivered is a neighborhood store for liquids, powders, pods,
              dish, paper, and cleaning consumables. Skip the bulk-aisle haul. We pack the
              heavy stuff and drop it on your porch.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/shop">
                <Button size="lg">Shop household staples</Button>
              </Link>
              <Link href="/delivery-area">
                <Button size="lg" variant="outline">
                  Check delivery area
                </Button>
              </Link>
            </div>
          </div>
          <Card className="space-y-4 bg-white">
            <div className="flex items-center gap-3">
              <MapPinned className="h-6 w-6 text-teal-700" aria-hidden />
              <div>
                <p className="font-semibold text-teal-950">Do we reach your porch?</p>
                <p className="text-sm text-teal-800">Try a demo ZIP such as 50309.</p>
              </div>
            </div>
            <DeliveryChecker compact />
          </Card>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="grid gap-4 md:grid-cols-3">
          {VALUE_PROPS.map((prop) => (
            <Card key={prop.title} className="space-y-3">
              <prop.icon className="h-6 w-6 text-teal-700" aria-hidden />
              <h2 className="text-lg font-semibold text-teal-950">{prop.title}</h2>
              <p className="text-sm leading-6 text-teal-800">{prop.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-teal-950">Featured this week</h2>
            <p className="mt-1 text-sm text-teal-800">
              Live products from the same inventory database we receive against.
            </p>
          </div>
          <Link
            href="/shop"
            className="text-sm font-semibold text-teal-800 hover:text-teal-950"
          >
            Shop all
          </Link>
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

      <section className="bg-teal-950 text-teal-50">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <h2 className="text-2xl font-semibold">How it works</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
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
    </div>
  );
}
