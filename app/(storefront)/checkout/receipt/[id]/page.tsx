import { requireAuth } from "@/lib/authz";
import { ownedCheckout } from "@/lib/commerce/checkout";
import { publicCheckout } from "@/lib/commerce/quote";
import { CheckoutReceipt } from "@/components/commerce/checkout-receipt";
import { rewardBalance } from "@/lib/services/loyalty";
import { prisma } from "@/lib/prisma";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const a = await ownedCheckout(session.user.id, (await params).id);
  const wallet = await rewardBalance(prisma, a.customerId);
  return (
    <div className="px-4 py-10">
      <CheckoutReceipt
        initial={{ ...publicCheckout(a), remainingRewardsCents: wallet.availableCents }}
      />
    </div>
  );
}
