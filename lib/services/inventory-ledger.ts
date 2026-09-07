import type { InventoryTxnType, Prisma } from "@prisma/client";
import {
  applyTransaction,
  InventoryError,
  type InventoryBalanceSnapshot,
} from "@/lib/domain/inventory";

export { InventoryError };

export function emptyBalance(): InventoryBalanceSnapshot {
  return { onHandQty: 0, reservedQty: 0, damagedQty: 0, inTransitQty: 0 };
}

export function snapshotFromRow(row: {
  onHandQty: number;
  reservedQty: number;
  damagedQty: number;
  inTransitQty: number;
} | null): InventoryBalanceSnapshot {
  if (!row) return emptyBalance();
  return {
    onHandQty: row.onHandQty,
    reservedQty: row.reservedQty,
    damagedQty: row.damagedQty,
    inTransitQty: row.inTransitQty,
  };
}

function signedQuantity(type: InventoryTxnType, quantity: number): number {
  switch (type) {
    case "PURCHASE_RECEIPT":
    case "RECEIPT":
    case "RETURN":
    case "TRANSFER_IN":
    case "RESERVE":
    case "CUSTOMER_RESERVATION":
    case "ROUTE_ALLOCATION":
      return quantity;
    case "ADJUSTMENT":
    case "COUNT":
      return quantity;
    case "SALE":
    case "DELIVERY":
    case "RELEASE":
    case "RESERVATION_RELEASE":
    case "DAMAGE":
    case "LOSS":
    case "TRANSFER":
    case "TRANSFER_OUT":
    case "ROUTE_LOAD":
      return -Math.abs(quantity);
    default:
      return quantity;
  }
}

export async function persistInventoryTransaction(
  db: Prisma.TransactionClient,
  input: {
    productVariantId: string;
    type: InventoryTxnType;
    quantity: number;
    inboundDamage?: boolean;
    referenceType?: string;
    referenceId?: string;
    reason?: string;
    createdByUserId?: string | null;
  },
) {
  const existing = await db.inventoryBalance.findUnique({
    where: { productVariantId: input.productVariantId },
  });
  const current = snapshotFromRow(existing);
  const next = applyTransaction(current, {
    type: input.type,
    quantity: input.quantity,
    inboundDamage: input.inboundDamage,
  });

  const txn = await db.inventoryTransaction.create({
    data: {
      productVariantId: input.productVariantId,
      type: input.type,
      quantity: signedQuantity(input.type, input.quantity),
      resultingOnHand: next.onHandQty,
      resultingReserved: next.reservedQty,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reason: input.reason,
      createdByUserId: input.createdByUserId ?? undefined,
    },
  });

  await db.inventoryBalance.upsert({
    where: { productVariantId: input.productVariantId },
    create: {
      productVariantId: input.productVariantId,
      onHandQty: next.onHandQty,
      reservedQty: next.reservedQty,
      damagedQty: next.damagedQty ?? 0,
      inTransitQty: next.inTransitQty ?? 0,
    },
    update: {
      onHandQty: next.onHandQty,
      reservedQty: next.reservedQty,
      damagedQty: next.damagedQty ?? 0,
      inTransitQty: next.inTransitQty ?? existing?.inTransitQty ?? 0,
    },
  });

  return { txn, balance: next };
}
