import { requireRole } from "@/lib/authz";
import { revenueOrders } from "@/lib/services/operations";
import { businessDate, dateSchema } from "@/lib/domain/operations";
import { RevenueTable } from "@/components/admin/revenue-table";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN");
  const q = await searchParams;
  const parsed = dateSchema.safeParse(q.date);
  const date = parsed.success ? parsed.data : businessDate();
  return (
    <RevenueTable
      title="Total revenue · month to date"
      subtitle="Paid orders purchased this month, less recorded refunds. Includes tax."
      date={date}
      path="/admin/reports/revenue"
      rows={await revenueOrders(session.user.id, date)}
    />
  );
}
