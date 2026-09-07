import { Card } from "@/components/ui/card";

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Dashboard</h1>
        <p className="mt-2 text-teal-800">
          Operations shell for Detergents Delivered. Catalog, purchasing, and
          inventory are live. Checkout, delivery, and accounting integrations
          come in later phases.
        </p>
      </div>
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
