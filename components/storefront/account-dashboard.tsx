import Link from "next/link";
import { UserRound, LockKeyhole, Bell, Headphones, Gift } from "lucide-react";
import { DeliveryWidget } from "@/components/account/delivery-widget";
import { formatCents } from "@/lib/domain/money";
import type { DeliverySnapshot } from "@/lib/domain/loyalty";
import { Card } from "@/components/ui/card";
import { AccountOrders } from "@/components/account/orders";
import type {
  getCustomerAccount,
  getCustomerOrders,
} from "@/lib/services/customer-account";
export function AccountDashboard({
  account,
  orders,
  delivery,
  rewardCents,
}: {
  delivery: DeliverySnapshot;
  rewardCents: number;
  account: Awaited<ReturnType<typeof getCustomerAccount>>;
  orders: Awaited<ReturnType<typeof getCustomerOrders>>;
}) {
  const shortcuts = [
    {
      href: "/account/settings/profile",
      label: "Edit customer info",
      text: "Name and contact details",
      Icon: UserRound,
    },
    {
      href: "/account/settings/security",
      label: "Change password",
      text: "Keep your account secure",
      Icon: LockKeyhole,
    },
    {
      href: "/account/settings/notifications",
      label: "Notifications",
      text: "Email and SMS on or off",
      Icon: Bell,
    },
    {
      href: "/account/support",
      label: "Support tickets",
      text: "Track problems and replies",
      Icon: Headphones,
    },
  ] as const;
  return (
    <div className="space-y-8">
      <Card className="space-y-2">
        <h2 className="text-xl font-semibold">
          {account.firstName ? `Hello, ${account.firstName}` : "Your account"}
        </h2>
        <p className="text-sm break-all text-teal-800">{account.email}</p>
        <p className="text-sm text-teal-700">
          Account created:{" "}
          {new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Chicago",
            dateStyle: "long",
          }).format(new Date(account.createdAt))}
        </p>
        {account.customerCreatedAt && (
          <p className="text-sm text-teal-700">
            Customer since:{" "}
            {new Intl.DateTimeFormat("en-US", {
              timeZone: "America/Chicago",
              dateStyle: "long",
            }).format(new Date(account.customerCreatedAt))}
          </p>
        )}
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {shortcuts.map(({ href, label, text, Icon }) => (
          <Link
            href={href}
            key={href}
            className="rounded-3xl focus-visible:outline-2 focus-visible:outline-teal-700"
          >
            <Card className="flex h-32 items-center gap-4 hover:bg-teal-50">
              <Icon className="h-6 w-6 shrink-0 text-teal-700" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">{label}</h2>
                <p className="text-sm text-teal-700">{text}</p>
              </div>
            </Card>
          </Link>
        ))}
        <DeliveryWidget initial={delivery} />
        <Link
          href="/account/loyalty"
          data-testid="loyalty-widget"
          className="rounded-3xl focus-visible:outline-2 focus-visible:outline-teal-700"
        >
          <Card className="flex h-32 items-center gap-4 hover:bg-teal-50">
            <Gift className="h-6 w-6 shrink-0 text-teal-700" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">Loyalty Club</h2>
              <p className="text-sm text-teal-700">
                {formatCents(rewardCents)} rewards available
              </p>
            </div>
          </Card>
        </Link>
      </div>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Orders & delivery updates</h2>
          <Link
            href="/account/support/new"
            className="font-semibold text-teal-800 underline"
          >
            Contact us
          </Link>
        </div>
        <AccountOrders orders={orders} />
      </section>
      <Card className="space-y-2">
        <h2 className="text-xl font-semibold">Quarterly subscriptions</h2>
        <p className="text-sm text-teal-800">
          Manage quarterly schedules, pause, skip or cancel future quarters. Each purchase
          requires review and payment.
        </p>
        <Link
          href="/account/subscriptions"
          className="inline-block text-sm font-semibold text-teal-800 underline"
        >
          Manage subscriptions
        </Link>
      </Card>
    </div>
  );
}
