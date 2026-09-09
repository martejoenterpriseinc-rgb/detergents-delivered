import Link from "next/link";
import { requireAuth } from "@/lib/authz";
import { getLoyalty } from "@/lib/services/loyalty";
import { LoyaltyCustomer } from "@/components/loyalty/customer";
export default async function Page() {
  const session = await requireAuth();
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <Link href="/account" className="font-semibold">
        ← Your account
      </Link>
      <h1 className="text-3xl font-semibold">Loyalty Club</h1>
      <p>Track your referrals, earned credits and rewards used on orders.</p>
      <LoyaltyCustomer initial={await getLoyalty(session.user.id)} />
    </div>
  );
}
