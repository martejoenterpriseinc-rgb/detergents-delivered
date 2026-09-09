import Link from "next/link";
import { UserRound, LockKeyhole, Bell, Truck, Headphones, Gift } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AccountOrders } from "@/components/account/orders";
import type {
  getCustomerAccount,
  getCustomerOrders,
} from "@/lib/services/customer-account";
export function AccountDashboard({
  account,
  orders,
}: {
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
      href: "/account/deliveries",
      label: "Delivery status",
      text: "View saved delivery updates",
      Icon: Truck,
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
            <Card className="flex h-full items-center gap-4 hover:bg-teal-50">
              <Icon className="h-6 w-6 shrink-0 text-teal-700" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">{label}</h2>
                <p className="text-sm text-teal-700">{text}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="flex items-start gap-4">
        <Gift className="h-7 w-7 shrink-0 text-teal-700" aria-hidden="true" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Loyalty Club</h2>
          <p className="text-sm font-semibold text-teal-800">Coming soon</p>
          <p className="text-sm text-teal-700">
            Membership, points, and rewards will appear here when the program launches. No
            rewards balance has been issued.
          </p>
        </div>
      </Card>
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
          Every three months, with payment at purchase. Subscription checkout and Order
          now are not connected yet.
        </p>
        <Link
          href="/account/subscriptions"
          className="inline-block text-sm font-semibold text-teal-800 underline"
        >
          Subscription details
        </Link>
      </Card>
    </div>
  );
}
