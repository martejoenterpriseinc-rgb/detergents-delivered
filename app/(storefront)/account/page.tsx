import { getLoyalty } from "@/lib/services/loyalty";
import { getDeliveryWidget } from "@/lib/services/delivery-widget";
import { requireAuth } from "@/lib/authz";
import { AccountDashboard } from "@/components/storefront/account-dashboard";
import { signOutAction } from "../actions";
import Link from "next/link";
import { getCustomerAccount, getCustomerOrders } from "@/lib/services/customer-account";
import { ADMIN_SHELL_ROLES, hasRole } from "@/lib/domain/authz";
import { Button } from "@/components/ui/button";

export default async function AccountPage() {
  const session = await requireAuth();
  const [account, orders, delivery, loyalty] = await Promise.all([
    getCustomerAccount(session.user.id),
    getCustomerOrders(session.user.id),
    getDeliveryWidget(session.user.id),
    getLoyalty(session.user.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-teal-950">Your household</h1>
          <p className="mt-2 text-teal-800">
            Your details, orders, deliveries, and support in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {hasRole(session.user.roles, ADMIN_SHELL_ROLES) && (
            <Link href="/admin" className="font-semibold text-teal-800 underline">
              Back to admin
            </Link>
          )}
          <form action={signOutAction}>
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </div>
      </div>
      <div className="mt-8">
        <AccountDashboard account={account} orders={orders} delivery={delivery} rewardCents={loyalty.balance.availableCents} />
      </div>
    </div>
  );
}
