import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-20">
      <section className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <p className="text-sm font-semibold tracking-[0.2em] text-teal-700 uppercase">
            Local household delivery
          </p>
          <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-teal-950 sm:text-5xl">
            Detergent, softener, and everyday essentials — delivered.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-teal-900/80">
            Detergents Delivered is a standalone local store for liquids, powders, pods,
            dish, paper, and cleaning consumables. Subscribe or order when you need a
            restock. We handle inventory, routes, and the books in one place.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/shop">
              <Button size="lg">Browse the shop</Button>
            </Link>
            <Link href="/sign-in">
              <Button size="lg" variant="outline">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
        <Card className="flex flex-col items-center gap-4 bg-teal-50 text-center">
          <BrandLogo size={96} className="h-16 max-w-[18rem] sm:h-24 sm:max-w-[22rem]" />
          <p className="text-lg font-semibold text-teal-950">
            Clean, convenient, on time
          </p>
          <p className="text-sm text-teal-800">
            Mobile-first storefront, admin, inventory, and driver mode — one app.
          </p>
        </Card>
      </section>
    </div>
  );
}
