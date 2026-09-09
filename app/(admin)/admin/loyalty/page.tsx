import { PromotionSettings } from "@/components/loyalty/promotion-settings";
import { promotionSchema } from "@/lib/domain/promotions";
import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { programConfig } from "@/lib/services/loyalty";
import { ProgramSettings } from "@/components/loyalty/admin";
import { Card } from "@/components/ui/card";
import { formatCents } from "@/lib/domain/money";
export default async function Page() {
  await requireRole("ADMIN", "SUPER_ADMIN");
  const [config, pending, rewarded, issued] = await Promise.all([
    programConfig(),
    prisma.referral.count({ where: { linkId: { not: null }, status: "PENDING" } }),
    prisma.referral.count({ where: { linkId: { not: null }, status: "REWARDED" } }),
    prisma.rewardEntry.aggregate({
      where: { kind: "REFERRAL" },
      _sum: { amountCents: true },
    }),
  ]);
  const promotions = (
    await prisma.promotion.findMany({ orderBy: { createdAt: "desc" }, take: 200 })
  ).flatMap((p) => {
    const parsed = promotionSchema.safeParse({
      code: p.code,
      name: p.name,
      value: p.value,
      valueType: p.valueType,
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      minimumPurchaseCents: p.minimumPurchaseCents,
      maximumDiscountCents: p.maximumDiscountCents,
      audience: p.audience,
      allowRewards: p.allowRewards,
      isActive: p.isActive,
      version: p.version,
    });
    return parsed.success ? [parsed.data] : [];
  });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold">Loyalty program</h1>
      <p>
        Configure referral rewards and review qualifying purchases. All changes preserve
        the rewards ledger.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/admin/loyalty/referrals?status=PENDING">
          <Card>
            <h2>Pending referrals</h2>
            <p className="my-2 text-3xl font-semibold">{pending}</p>
            <p className="text-sm">View referrals →</p>
          </Card>
        </Link>
        <Link href="/admin/loyalty/referrals?status=REWARDED">
          <Card>
            <h2>Rewarded referrals</h2>
            <p className="my-2 text-3xl font-semibold">{rewarded}</p>
            <p className="text-sm">View qualifying purchases →</p>
          </Card>
        </Link>
        <Link href="/admin/loyalty/rewards?kind=REFERRAL">
          <Card>
            <h2>Referral credits issued</h2>
            <p className="my-2 text-3xl font-semibold">
              {formatCents(issued._sum.amountCents ?? 0)}
            </p>
            <p className="text-sm">View ledger entries →</p>
          </Card>
        </Link>
      </div>
      <ProgramSettings initial={config} />
      <PromotionSettings initial={promotions} />
      <Link
        href="/admin/loyalty/rewards"
        className="inline-block font-semibold underline"
      >
        View all rewards activity
      </Link>
    </div>
  );
}
