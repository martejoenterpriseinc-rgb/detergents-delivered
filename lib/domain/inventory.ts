/**
 * Inventory math — balances are projections of the ledger.
 * available = onHand - reserved. Never allow negative on-hand or available.
 */

export type InventoryBalanceSnapshot = {
  onHandQty: number;
  reservedQty: number;
  damagedQty?: number;
  inTransitQty?: number;
};

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

export function assertQty(value: number, label = "quantity"): number {
  if (!Number.isInteger(value)) {
    throw new InventoryError(`${label} must be an integer`);
  }
  return value;
}

export function availableQty(balance: InventoryBalanceSnapshot): number {
  assertQty(balance.onHandQty, "onHandQty");
  assertQty(balance.reservedQty, "reservedQty");
  if (balance.onHandQty < 0) {
    throw new InventoryError("on-hand quantity cannot be negative");
  }
  if (balance.reservedQty < 0) {
    throw new InventoryError("reserved quantity cannot be negative");
  }
  const available = balance.onHandQty - balance.reservedQty;
  if (available < 0) {
    throw new InventoryError("available quantity cannot be negative");
  }
  return available;
}

export function applyOnHandDelta(
  balance: InventoryBalanceSnapshot,
  delta: number,
): InventoryBalanceSnapshot {
  assertQty(delta, "delta");
  const nextOnHand = balance.onHandQty + delta;
  if (nextOnHand < 0) {
    throw new InventoryError("inventory transaction would make on-hand negative");
  }
  const next = { ...balance, onHandQty: nextOnHand };
  availableQty(next);
  return next;
}

export function applyReserveDelta(
  balance: InventoryBalanceSnapshot,
  delta: number,
): InventoryBalanceSnapshot {
  assertQty(delta, "delta");
  const nextReserved = balance.reservedQty + delta;
  if (nextReserved < 0) {
    throw new InventoryError("inventory transaction would make reserved negative");
  }
  const next = { ...balance, reservedQty: nextReserved };
  availableQty(next);
  return next;
}

export function canFulfill(
  balance: InventoryBalanceSnapshot,
  quantity: number,
): boolean {
  assertQty(quantity, "quantity");
  if (quantity < 0) {
    throw new InventoryError("fulfill quantity cannot be negative");
  }
  return availableQty(balance) >= quantity;
}

export function rejectOversell(
  balance: InventoryBalanceSnapshot,
  quantity: number,
): void {
  if (!canFulfill(balance, quantity)) {
    throw new InventoryError("insufficient available inventory (oversell rejected)");
  }
}
