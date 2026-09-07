import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DemoBanner } from "@/components/storefront/demo-banner";

export default function ReferralsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-teal-950">Refer a household</h1>
      <p className="mt-3 text-lg text-teal-800">
        Neighbors run out of detergent on the same week. When referrals launch, you will
        share a code and both households will get credit on a future delivery.
      </p>
      <DemoBanner className="mt-6">
        Referral tracking, credits, and promo codes are not live. This page is a
        placeholder for the Phase 5 program.
      </DemoBanner>
      <Card className="mt-6 space-y-4">
        <p className="font-semibold text-teal-950">How it will work</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-teal-800">
          <li>You get a short code from your account.</li>
          <li>A neighbor uses it on their first paid order in our delivery area.</li>
          <li>Both of you receive store credit after that order is delivered.</li>
        </ol>
        <p className="rounded-2xl bg-teal-50 px-4 py-3 font-mono text-sm text-teal-900">
          Your preview code: CLEAN-PORCH
        </p>
        <Link href="/shop">
          <Button>Shop while this is in preview</Button>
        </Link>
      </Card>
    </div>
  );
}
