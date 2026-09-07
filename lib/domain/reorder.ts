import { availableQty, type InventoryBalanceSnapshot } from "./inventory";

export type ReorderInput = {
  variantId: string;
  sku: string;
  name: string;
  reorderPoint: number | null;
  reorderQty: number | null;
  balance: InventoryBalanceSnapshot;
};

export type ReorderRecommendation = {
  variantId: string;
  sku: string;
  name: string;
  available: number;
  onHand: number;
  reserved: number;
  reorderPoint: number;
  recommendedQty: number;
  reason: "out_of_stock" | "low_stock";
};

export function reorderRecommendations(items: ReorderInput[]): ReorderRecommendation[] {
  const recommendations: ReorderRecommendation[] = [];

  for (const item of items) {
    const available = availableQty(item.balance);
    const point = item.reorderPoint;
    if (point === null || point < 0) {
      if (available === 0) {
        recommendations.push({
          variantId: item.variantId,
          sku: item.sku,
          name: item.name,
          available,
          onHand: item.balance.onHandQty,
          reserved: item.balance.reservedQty,
          reorderPoint: 0,
          recommendedQty: item.reorderQty && item.reorderQty > 0 ? item.reorderQty : 1,
          reason: "out_of_stock",
        });
      }
      continue;
    }

    if (available <= point) {
      recommendations.push({
        variantId: item.variantId,
        sku: item.sku,
        name: item.name,
        available,
        onHand: item.balance.onHandQty,
        reserved: item.balance.reservedQty,
        reorderPoint: point,
        recommendedQty: item.reorderQty && item.reorderQty > 0 ? item.reorderQty : Math.max(point - available + 1, 1),
        reason: available === 0 ? "out_of_stock" : "low_stock",
      });
    }
  }

  return recommendations;
}
