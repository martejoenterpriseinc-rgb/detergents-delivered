import { InventoryAdjustmentForm } from "@/components/admin/inventory-adjustment-form";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/authz";
import { formatCents } from "@/lib/domain/money";
import { loadInventoryDashboard } from "@/lib/services/inventory";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  await requireRole("ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN");
  const dashboard = await loadInventoryDashboard();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Inventory</h1>
        <p className="mt-2 text-sm text-teal-800">
          Available is computed (on-hand − reserved). Value uses remaining cost layers.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <p className="text-xs uppercase text-teal-700">Total value</p>
          <p className="mt-2 text-2xl font-semibold">{formatCents(dashboard.totals.valueCents)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-teal-700">On hand / available / reserved</p>
          <p className="mt-2 text-2xl font-semibold">
            {dashboard.totals.onHand} / {dashboard.totals.available} / {dashboard.totals.reserved}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-teal-700">Low / out</p>
          <p className="mt-2 text-2xl font-semibold">
            {dashboard.totals.lowStock} / {dashboard.totals.outOfStock}
          </p>
        </Card>
      </div>
      <Card>
        <h2 className="text-lg font-semibold text-teal-950">Reorder recommendations</h2>
        <ul className="mt-3 space-y-2 text-sm text-teal-800">
          {dashboard.recommendations.map((rec) => (
            <li key={rec.variantId}>
              {rec.sku} · {rec.name} · {rec.reason.replace("_", " ")} · order {rec.recommendedQty}
            </li>
          ))}
          {dashboard.recommendations.length === 0 ? <li>Nothing below reorder point.</li> : null}
        </ul>
      </Card>
      <div className="overflow-x-auto rounded-3xl border border-teal-100 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-teal-100 text-xs uppercase text-teal-700">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">On hand</th>
              <th className="px-4 py-3">Reserved</th>
              <th className="px-4 py-3">Available</th>
              <th className="px-4 py-3">Retail</th>
              <th className="px-4 py-3">Avg landed</th>
              <th className="px-4 py-3">GP / margin</th>
              <th className="px-4 py-3">Value</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.rows.map((row) => (
              <tr key={row.variant.id} className="border-b border-teal-50 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-teal-950">{row.variant.sku}</div>
                  <div className="text-xs text-teal-700">{row.variant.product.name}</div>
                </td>
                <td className="px-4 py-3">{row.balance.onHandQty}</td>
                <td className="px-4 py-3">{row.balance.reservedQty}</td>
                <td className="px-4 py-3">{row.available}</td>
                <td className="px-4 py-3">
                  {row.retailCents !== null ? formatCents(row.retailCents) : "—"}
                </td>
                <td className="px-4 py-3">
                  {row.avgLandedCents !== null ? formatCents(row.avgLandedCents) : "—"}
                </td>
                <td className="px-4 py-3">
                  {row.profitCents !== null && row.margin !== null
                    ? `${formatCents(row.profitCents)} / ${row.margin.toFixed(1)}%`
                    : "—"}
                </td>
                <td className="px-4 py-3">{formatCents(row.valueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <InventoryAdjustmentForm
        variants={dashboard.rows.map((row) => ({
          id: row.variant.id,
          sku: row.variant.sku,
          name: row.variant.product.name,
        }))}
      />
    </div>
  );
}
