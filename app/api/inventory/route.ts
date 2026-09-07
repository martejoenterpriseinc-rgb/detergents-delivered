import { requireApiRole } from "@/lib/api-auth";
import { loadInventoryDashboard } from "@/lib/services/inventory";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const dashboard = await loadInventoryDashboard();
  return Response.json({
    totals: dashboard.totals,
    recommendations: dashboard.recommendations,
    rows: dashboard.rows.map((row) => ({
      variantId: row.variant.id,
      sku: row.variant.sku,
      upc: row.variant.upc,
      name: row.variant.name,
      productName: row.variant.product.name,
      productId: row.variant.productId,
      onHand: row.balance.onHandQty,
      reserved: row.balance.reservedQty,
      available: row.available,
      damaged: row.balance.damagedQty,
      valueCents: row.valueCents,
      avgLandedCents: row.avgLandedCents,
      reorderPoint: row.variant.reorderPoint,
      reorderQty: row.variant.reorderQty,
    })),
  });
}
