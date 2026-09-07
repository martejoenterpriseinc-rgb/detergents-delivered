/**
 * Inventory math — balances are projections of the ledger.
 * available = onHand - reserved. Never allow negative on-hand or available.
 */

export const INVENTORY_TXN_TYPES = [
  "RECEIPT",
  "PURCHASE_RECEIPT",
  "SALE",
  "RESERVE",
  "CUSTOMER_RESERVATION",
  "RELEASE",
  "RESERVATION_RELEASE",
  "ROUTE_ALLOCATION",
  "ROUTE_LOAD",
  "DELIVERY",
  "ADJUSTMENT",
  "RETURN",
  "DAMAGE",
  "LOSS",
  "COUNT",
  "TRANSFER",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;

export type InventoryTxnTypeCode = (typeof INVENTORY_TXN_TYPES)[number];

export type InventoryBalanceSnapshot = {
  onHandQty: number;
  reservedQty: number;
  damagedQty?: number;
  inTransitQty?: number;
};

export type ApplyTransactionInput = {
  type: InventoryTxnTypeCode;
  /** Magnitude for typed moves; signed for ADJUSTMENT / COUNT. */
  quantity: number;
  /** Damaged units that never entered sellable on-hand (receiving). */
  inboundDamage?: boolean;
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

function withDamaged(
  balance: InventoryBalanceSnapshot,
  damagedQty: number,
): InventoryBalanceSnapshot {
  if (damagedQty < 0) {
    throw new InventoryError("damaged quantity cannot be negative");
  }
  return { ...balance, damagedQty };
}

/**
 * Validate a ledger movement and return the next balance projection.
 * Callers persist an InventoryTransaction, then write this projection — never a silent overwrite.
 */
export function applyTransaction(
  balance: InventoryBalanceSnapshot,
  input: ApplyTransactionInput,
): InventoryBalanceSnapshot {
  const qty = assertQty(input.quantity, "quantity");
  const damaged = balance.damagedQty ?? 0;

  switch (input.type) {
    case "PURCHASE_RECEIPT":
    case "RECEIPT":
    case "RETURN":
    case "TRANSFER_IN": {
      if (qty < 0) {
        throw new InventoryError(`${input.type} quantity must be non-negative`);
      }
      return applyOnHandDelta(balance, qty);
    }
    case "CUSTOMER_RESERVATION":
    case "RESERVE":
    case "ROUTE_ALLOCATION": {
      if (qty < 0) {
        throw new InventoryError(`${input.type} quantity must be non-negative`);
      }
      rejectOversell(balance, qty);
      return applyReserveDelta(balance, qty);
    }
    case "RESERVATION_RELEASE":
    case "RELEASE": {
      if (qty < 0) {
        throw new InventoryError(`${input.type} quantity must be non-negative`);
      }
      return applyReserveDelta(balance, -qty);
    }
    case "ROUTE_LOAD": {
      if (qty < 0) {
        throw new InventoryError("ROUTE_LOAD quantity must be non-negative");
      }
      if (qty > balance.reservedQty) {
        throw new InventoryError("cannot load more units than reserved for the route");
      }
      return { ...balance };
    }
    case "DELIVERY":
    case "SALE": {
      if (qty < 0) {
        throw new InventoryError(`${input.type} quantity must be non-negative`);
      }
      const reserved = applyReserveDelta(balance, -qty);
      return applyOnHandDelta(reserved, -qty);
    }
    case "DAMAGE": {
      if (qty < 0) {
        throw new InventoryError("DAMAGE quantity must be non-negative");
      }
      if (input.inboundDamage) {
        return withDamaged(balance, damaged + qty);
      }
      const next = applyOnHandDelta(balance, -qty);
      return withDamaged(next, damaged + qty);
    }
    case "LOSS":
    case "TRANSFER":
    case "TRANSFER_OUT": {
      if (qty < 0) {
        throw new InventoryError(`${input.type} quantity must be non-negative`);
      }
      return applyOnHandDelta(balance, -qty);
    }
    case "ADJUSTMENT":
    case "COUNT": {
      return applyOnHandDelta(balance, qty);
    }
    default: {
      const _exhaustive: never = input.type;
      throw new InventoryError(`unsupported inventory transaction type: ${_exhaustive}`);
    }
  }
}
