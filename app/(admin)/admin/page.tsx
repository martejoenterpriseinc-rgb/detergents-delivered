import { BusinessSetupCard } from "@/components/business/dashboard-card";
import { requireAuth } from "@/lib/authz";
import { supportKpis } from "@/lib/services/support";
import { customerDirectory, dailyQueue, revenueOrders } from "@/lib/services/operations";
import { businessDate } from "@/lib/domain/operations";
import { OperationsOverview } from "@/components/admin/operations-overview";
export default async function AdminDashboardPage() {
  const session = await requireAuth();
  if (!session.user.roles.some((r) => ["ADMIN", "SUPER_ADMIN"].includes(r)))
    return (
      <div>
        <h1>Operations workspace</h1>
        <p>Select an authorized workspace from the menu.</p>
      </div>
    );
  const date = businessDate();
  const [queue, customers, revenue, support] = await Promise.all([
    dailyQueue(session.user.id, date),
    customerDirectory(session.user.id, { date }),
    revenueOrders(session.user.id, date),
    supportKpis(session.user.id),
  ]);
  return (
    <>
      <BusinessSetupCard userId={session.user.id} />
      <OperationsOverview
        date={date}
        queue={queue}
        customers={customers}
        revenue={revenue}
        support={support}
      />
    </>
  );
}
