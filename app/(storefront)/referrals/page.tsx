import Link from "next/link";
import { Card } from "@/components/ui/card";
import { programConfig } from "@/lib/services/loyalty";
import { formatCents } from "@/lib/domain/money";
export const dynamic = "force-dynamic";
export default async function ReferralsPage() {
  const program = await programConfig();
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-12">
      <h1 className="text-3xl font-semibold">Refer a household</h1>
      <Card className="space-y-4">
        <h2 className="text-xl font-semibold">Loyalty Club</h2>
        <p>
          {program.enabled
            ? `Earn ${formatCents(program.referrerRewardCents)} when a referred neighbor makes a qualifying first paid purchase. Your neighbor earns ${formatCents(program.friendRewardCents)} for a future purchase.`
            : "New referrals are currently paused. You can view existing links and earned credits in your account."}
        </p>
        <p className="text-sm text-teal-700">
          Verified accounts and delivery eligibility are required. Minimum merchandise
          purchase: {formatCents(program.minimumPurchaseCents)}. Referral credits are
          awarded after a qualifying paid first order; refunds or cancellations reverse
          those rewards.
        </p>
        <p className="rounded-2xl bg-amber-50 p-4 text-sm">
          No reward is earned just by creating, sharing or opening a link. A qualifying
          first purchase must be verified before credits are awarded.
        </p>
        <Link
          href="/account/loyalty"
          className="inline-block rounded-full bg-teal-700 px-5 py-3 font-semibold text-white"
        >
          Open Loyalty Club
        </Link>
      </Card>
    </div>
  );
}
