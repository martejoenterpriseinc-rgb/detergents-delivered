import Link from "next/link";
import { getCustomerAccount } from "@/lib/services/customer-account";
import { requireAuth } from "@/lib/authz";
import { readSubscriptions } from "@/lib/services/subscriptions";
import { SubscriptionManager } from "@/components/account/subscriptions";
export default async function AccountSubscriptionsPage() {
  const session = await requireAuth();
  const account = await getCustomerAccount(session.user.id);
  if (!account.hasCustomer)
    return (
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <h1 className="text-3xl font-semibold">Subscriptions</h1>
        <p>Quarterly subscriptions are managed through a household account.</p>
        <Link href="/account" className="underline">
          Back to account
        </Link>
      </main>
    );
  const data = await readSubscriptions(session.user.id);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-semibold text-teal-950">Subscriptions</h1>
      <SubscriptionManager data={data} />
    </main>
  );
}
