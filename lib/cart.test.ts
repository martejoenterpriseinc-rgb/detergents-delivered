import { describe, expect, it } from "vitest";
import {
  cartItemCount,
  cartSubtotalCents,
  demoDeliveryFeeCents,
  demoOrderTotals,
  lineTotalCents,
  parseCartSnapshot,
  setCartLineQuantity,
  upsertCartLine,
  type CartLine,
} from "./cart";

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  variantId: "v1",
  productId: "p1",
  slug: "fresh-breeze-liquid-detergent",
  productName: "Fresh Breeze liquid detergent",
  variantName: "64 oz",
  sku: "DD-LIQ-64-FRESH",
  brand: "Detergents Delivered",
  sizeLabel: "64 oz",
  scent: "Fresh Breeze",
  unitPriceCents: 1299,
  quantity: 1,
  imageId: null,
  ...overrides,
});

describe("cart helpers", () => {
  it("adds quantities for the same variant and computes integer subtotals", () => {
    const once = upsertCartLine([], line({ quantity: 2 }));
    const twice = upsertCartLine(once, line({ quantity: 1 }));
    expect(twice).toHaveLength(1);
    expect(twice[0].quantity).toBe(3);
    expect(lineTotalCents(twice[0])).toBe(3897);
    expect(cartSubtotalCents(twice)).toBe(3897);
    expect(cartItemCount(twice)).toBe(3);
  });

  it("removes a line when quantity is set to zero", () => {
    const next = setCartLineQuantity([line()], "v1", 0);
    expect(next).toEqual([]);
  });

  it("parses stored snapshots and ignores broken payloads", () => {
    expect(parseCartSnapshot(null).lines).toEqual([]);
    expect(parseCartSnapshot("{not-json").lines).toEqual([]);
    const parsed = parseCartSnapshot(
      JSON.stringify({
        lines: [line({ quantity: 2 })],
        updatedAt: "2026-09-07T00:00:00.000Z",
      }),
    );
    expect(parsed.lines[0]?.quantity).toBe(2);
  });

  it("applies demo delivery and tax in cents", () => {
    expect(demoDeliveryFeeCents(2000)).toBe(499);
    expect(demoDeliveryFeeCents(3500)).toBe(0);
    expect(demoOrderTotals(2000)).toEqual({
      subtotalCents: 2000,
      deliveryFeeCents: 499,
      taxCents: 140,
      totalCents: 2639,
    });
  });
});
