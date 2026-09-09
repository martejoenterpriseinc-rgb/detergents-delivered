import Link from "next/link";
import { requireAuth } from "@/lib/authz";
import { supportKpis } from "@/lib/services/support";
import { Card } from "@/components/ui/card";

export default async function AdminDashboardPage() {
  const session = await requireAuth();
  const counts = session.user.roles.some((r) => ["ADMIN", "SUPER_ADMIN"].includes(r))
    ? await supportKpis(session.user.id)
    : null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Dashboard</h1>
        <p className="mt-2 text-teal-800">
          Operations shell for Detergents Delivered. Catalog, purchasing, and inventory
          are live. Checkout, delivery, and accounting integrations come in later phases.
        </p>
      </div>
      {counts && (
        <Link
          href="/admin/support?status=ACTIVE"
          className="block rounded-3xl focus-visible:outline-2 focus-visible:outline-teal-700"
        >
          <Card className="hover:bg-teal-50">
            <h2 className="font-semibold">Support tickets</h2>
            <p className="mt-2 text-3xl font-semibold">
              {counts.OPEN + counts.IN_PROGRESS + counts.WAITING_CUSTOMER}
            </p>
            <p className="mt-2 text-sm text-teal-800">
              Active tickets · {counts.OPEN} open · {counts.IN_PROGRESS} in progress ·{" "}
              {counts.WAITING_CUSTOMER} waiting for customer
            </p>
            <p className="mt-2 text-sm font-semibold text-teal-800">
              View support queue →
            </p>
          </Card>
        </Link>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm font-medium text-teal-900">Today</p>
          <p className="mt-2 text-2xl font-semibold">—</p>
          <p className="text-xs text-teal-700">Orders and routes appear in Phase 3–5.</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-teal-900">Inventory</p>
          <p className="mt-2 text-2xl font-semibold">Receiving live</p>
          <p className="text-xs text-teal-700">Ledger + landed cost layers.</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-teal-900">Accounting</p>
          <p className="mt-2 text-2xl font-semibold">Cents only</p>
          <p className="text-xs text-teal-700">No live Stripe or QBO calls.</p>
        </Card>
      </div>
    </div>
  );
}
