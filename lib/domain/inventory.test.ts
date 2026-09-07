import { describe, expect, it } from "vitest";
import {
  applyOnHandDelta,
  applyReserveDelta,
  availableQty,
  canFulfill,
  InventoryError,
  rejectOversell,
} from "./inventory";

describe("inventory balance math", () => {
  it("computes available as onHand minus reserved", () => {
    expect(availableQty({ onHandQty: 10, reservedQty: 3 })).toBe(7);
    expect(availableQty({ onHandQty: 4, reservedQty: 4 })).toBe(0);
  });

  it("rejects negative on-hand, reserved, or available", () => {
    expect(() => availableQty({ onHandQty: -1, reservedQty: 0 })).toThrow(
      InventoryError,
    );
    expect(() => availableQty({ onHandQty: 2, reservedQty: 3 })).toThrow(
      InventoryError,
    );
    expect(() => applyOnHandDelta({ onHandQty: 1, reservedQty: 0 }, -2)).toThrow(
      InventoryError,
    );
  });

  it("rejects oversell against available quantity", () => {
    const balance = { onHandQty: 5, reservedQty: 2 };
    expect(canFulfill(balance, 3)).toBe(true);
    expect(canFulfill(balance, 4)).toBe(false);
    expect(() => rejectOversell(balance, 4)).toThrow(/oversell/);
  });

  it("applies reserve without allowing reserved to exceed on-hand", () => {
    const reserved = applyReserveDelta({ onHandQty: 8, reservedQty: 1 }, 2);
    expect(reserved.reservedQty).toBe(3);
    expect(availableQty(reserved)).toBe(5);
    expect(() => applyReserveDelta({ onHandQty: 8, reservedQty: 7 }, 2)).toThrow(
      InventoryError,
    );
  });
});
