import Link from "next/link";
import { requireAuth } from "@/lib/authz";
import { getCustomerOrders } from "@/lib/services/customer-account";
import { AccountOrders } from "@/components/account/orders";
export default async function Page() {
  const session = await requireAuth();
  const orders = await getCustomerOrders(session.user.id);
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link href="/account" className="font-semibold text-teal-800">
        ← Your account
      </Link>
      <h1 className="text-3xl font-semibold">Delivery status</h1>
      <p className="text-sm text-teal-800">
        Updates come from your saved orders and driver actions. Completed deliveries
        include their private proof photo when available. Arrival estimates use the saved
        route schedule; Waze provides navigation only.
      </p>
      <AccountOrders orders={orders} />
    </div>
  );
}
