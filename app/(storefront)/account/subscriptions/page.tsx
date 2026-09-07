import Link from "next/link";
import { requireAuth } from "@/lib/authz";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DemoBanner } from "@/components/storefront/demo-banner";

export default async function AccountSubscriptionsPage() {
  await requireAuth();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-teal-950">Subscriptions</h1>
      <p className="mt-2 text-teal-800">
        Pause, skip, and swap will live here when Phase 5 lands.
      </p>
      <DemoBanner className="mt-6">
        Subscription management is a placeholder. No cadence is billed.
      </DemoBanner>
      <Card className="mt-6 space-y-3">
        <p className="font-semibold text-teal-950">Fresh Breeze 64 oz · every 4 weeks</p>
        <p className="text-sm text-teal-800">
          Preview only. Next order date, skip, and variant swap are not connected to
          inventory or Stripe.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled>
            Pause
          </Button>
          <Button type="button" variant="outline" disabled>
            Skip next
          </Button>
          <Link href="/account">
            <Button variant="secondary">Back to account</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
