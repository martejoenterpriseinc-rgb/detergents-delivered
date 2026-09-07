import { describe, expect, it } from "vitest";
import { reorderRecommendations } from "./reorder";

describe("reorder recommendations", () => {
  it("flags low stock at or below reorder point", () => {
    const recs = reorderRecommendations([
      {
        variantId: "v1",
        sku: "DD-001",
        name: "64oz Fresh",
        reorderPoint: 6,
        reorderQty: 12,
        balance: { onHandQty: 8, reservedQty: 3 },
      },
      {
        variantId: "v2",
        sku: "DD-002",
        name: "Plenty",
        reorderPoint: 2,
        reorderQty: 8,
        balance: { onHandQty: 10, reservedQty: 0 },
      },
    ]);

    expect(recs).toHaveLength(1);
    expect(recs[0]?.sku).toBe("DD-001");
    expect(recs[0]?.reason).toBe("low_stock");
    expect(recs[0]?.recommendedQty).toBe(12);
    expect(recs[0]?.available).toBe(5);
  });

  it("treats zero available without a point as out of stock", () => {
    const recs = reorderRecommendations([
      {
        variantId: "v3",
        sku: "DD-003",
        name: "Gone",
        reorderPoint: null,
        reorderQty: null,
        balance: { onHandQty: 0, reservedQty: 0 },
      },
    ]);
    expect(recs[0]?.reason).toBe("out_of_stock");
    expect(recs[0]?.recommendedQty).toBe(1);
  });
});
