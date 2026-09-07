import { describe, expect, it } from "vitest";
import {
  applyOnHandDelta,
  applyReserveDelta,
  applyTransaction,
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

  it("applies purchase receipts onto on-hand without touching reserved", () => {
    const next = applyTransaction(
      { onHandQty: 2, reservedQty: 1 },
      { type: "PURCHASE_RECEIPT", quantity: 4 },
    );
    expect(next.onHandQty).toBe(6);
    expect(next.reservedQty).toBe(1);
    expect(availableQty(next)).toBe(5);
  });

  it("reserves then delivers without allowing oversell", () => {
    const reserved = applyTransaction(
      { onHandQty: 5, reservedQty: 0 },
      { type: "CUSTOMER_RESERVATION", quantity: 2 },
    );
    expect(reserved.reservedQty).toBe(2);
    const delivered = applyTransaction(reserved, { type: "DELIVERY", quantity: 2 });
    expect(delivered.onHandQty).toBe(3);
    expect(delivered.reservedQty).toBe(0);
    expect(() =>
      applyTransaction(
        { onHandQty: 3, reservedQty: 0 },
        { type: "CUSTOMER_RESERVATION", quantity: 4 },
      ),
    ).toThrow(/oversell/);
  });

  it("records inbound damage without creating sellable stock", () => {
    const next = applyTransaction(
      { onHandQty: 4, reservedQty: 0, damagedQty: 0 },
      { type: "DAMAGE", quantity: 2, inboundDamage: true },
    );
    expect(next.onHandQty).toBe(4);
    expect(next.damagedQty).toBe(2);
  });

  it("rejects a loss that would make on-hand negative", () => {
    expect(() =>
      applyTransaction({ onHandQty: 1, reservedQty: 0 }, { type: "LOSS", quantity: 2 }),
    ).toThrow(InventoryError);
  });
});
