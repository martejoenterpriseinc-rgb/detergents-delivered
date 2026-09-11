import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { dailyQueue } from "@/lib/services/operations";
import { businessDate, dateSchema } from "@/lib/domain/operations";
import { DeliveryQueue } from "@/components/admin/delivery-queue";
import { RevenueTable } from "@/components/admin/revenue-table";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN");
  const q = await searchParams;
  const date = dateSchema.safeParse(q.date);
  const data = await dailyQueue(
    session.user.id,
    date.success ? date.data : businessDate(),
  );
  if (q.report === "revenue") {
    const seen = new Set<string>();
    return (
      <RevenueTable
        title="Daily delivery revenue"
        subtitle="Paid orders on this delivery date, less recorded refunds. Includes tax."
        date={data.date}
        path="/admin/deliveries"
        hidden={{ report: "revenue" }}
        rows={data.stops
          .filter((s) => {
            if (!s.orderId || seen.has(s.orderId) || s.status === "BLOCKED") return false;
            seen.add(s.orderId);
            return true;
          })
          .map((s) => ({
            id: s.orderId!,
            number: s.orderNumber,
            customer: s.customer,
            placedAt: data.date,
            status: s.status,
            revenueCents: s.revenueCents,
          }))}
      />
    );
  }
  return (
    <div className="space-y-4">
      <Link href="/admin/deliveries/texts" className="font-semibold underline">
        Delivery text messages
      </Link>
      <DeliveryQueue
        key={`${data.date}-${q.status ?? "all"}`}
        initial={data}
        initialStatus={q.status === "completed" ? "completed" : "all"}
      />
    </div>
  );
}
