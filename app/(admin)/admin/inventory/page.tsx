import Link from "next/link";
import { hasRole } from "@/lib/domain/authz";
import { InventoryAdjustmentForm } from "@/components/admin/inventory-adjustment-form";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/authz";
import { formatCents } from "@/lib/domain/money";
import { loadInventoryDashboard } from "@/lib/services/inventory";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireRole("ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN");
  const dashboard = await loadInventoryDashboard();
  const filter = (await searchParams).stock ?? "all";
  const rows = dashboard.rows.filter((row) =>
    filter === "out"
      ? row.available === 0
      : filter === "low"
        ? row.available > 0 &&
          row.variant.reorderPoint !== null &&
          row.available <= row.variant.reorderPoint
        : filter === "reserved"
          ? row.balance.reservedQty > 0
          : true,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Inventory</h1>
        <p className="mt-2 text-sm text-teal-800">
          Available is computed (on-hand − reserved). Value uses remaining cost layers.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Inventory value",
            value: formatCents(dashboard.totals.valueCents),
            filter: "all",
          },
          { label: "Available units", value: dashboard.totals.available, filter: "all" },
          {
            label: "Reserved units",
            value: dashboard.totals.reserved,
            filter: "reserved",
          },
          { label: "Low-stock items", value: dashboard.totals.lowStock, filter: "low" },
          {
            label: "Out-of-stock items",
            value: dashboard.totals.outOfStock,
            filter: "out",
          },
        ].map((kpi) => (
          <Link
            key={kpi.label}
            href={`/admin/inventory?stock=${kpi.filter}#stock-list`}
            className="rounded-2xl border border-teal-100 bg-white p-5 hover:border-teal-500"
          >
            <p className="text-sm text-teal-700">{kpi.label}</p>
            <p className="mt-2 text-2xl font-semibold">{kpi.value}</p>
            <p className="mt-2 text-xs">View matching inventory →</p>
          </Link>
        ))}
      </div>
      <Card>
        <h2 className="text-lg font-semibold text-teal-950">Reorder recommendations</h2>
        <ul className="mt-3 space-y-2 text-sm text-teal-800">
          {dashboard.recommendations.map((rec) => (
            <li key={rec.variantId}>
              {rec.sku} · {rec.name} · {rec.reason.replace("_", " ")} · order{" "}
              {rec.recommendedQty}
            </li>
          ))}
          {dashboard.recommendations.length === 0 ? (
            <li>Nothing below reorder point.</li>
          ) : null}
        </ul>
      </Card>
      <div
        id="stock-list"
        className="overflow-x-auto rounded-3xl border border-teal-100 bg-white"
      >
        <table className="min-w-full text-left text-sm">
          <caption className="p-4 text-left">
            {filter === "low"
              ? "Low-stock inventory"
              : filter === "out"
                ? "Out-of-stock inventory"
                : filter === "reserved"
                  ? "Reserved inventory"
                  : "All inventory"}{" "}
            · {rows.length} items
          </caption>
          <thead className="border-b border-teal-100 text-xs text-teal-700 uppercase">
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
            {rows.map((row) => (
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
      {hasRole(session.user.roles, ["ADMIN", "INVENTORY", "SUPER_ADMIN"]) && (
        <InventoryAdjustmentForm
          variants={rows.map((row) => ({
            id: row.variant.id,
            sku: row.variant.sku,
            name: row.variant.product.name,
          }))}
        />
      )}
    </div>
  );
}
