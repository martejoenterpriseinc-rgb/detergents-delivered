import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/authz";
import { getCustomerOrders } from "@/lib/services/customer-account";
import { NewTicketForm } from "@/components/account/forms";
import { Card } from "@/components/ui/card";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const session = await requireAuth();
  const { orderId = "" } = await searchParams;
  const orders = await getCustomerOrders(session.user.id);
  if (orderId && !orders.some((o) => o.id === orderId)) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <Link href="/account/support" className="font-semibold text-teal-800">
        ← Support tickets
      </Link>
      <h1 className="text-3xl font-semibold">
        {orderId ? "Report a problem with your order" : "Contact us"}
      </h1>
      <Card>
        <NewTicketForm
          orders={orders.map((o) => ({ id: o.id, number: o.number }))}
          orderId={orderId}
        />
      </Card>
    </div>
  );
}
