import type { InventoryTxnType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { availableQty } from "@/lib/domain/inventory";
import { grossProfitCents, marginPercent } from "@/lib/domain/money";
import { reorderRecommendations } from "@/lib/domain/reorder";
import { persistInventoryTransaction } from "@/lib/services/inventory-ledger";
import { pickCurrentPrice } from "@/lib/prices";

export class AdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdjustmentError";
  }
}

export async function createInventoryAdjustment(input: {
  productVariantId: string;
  quantity: number;
  reason: string;
  notes?: string | null;
  type?: Extract<InventoryTxnType, "ADJUSTMENT" | "COUNT" | "LOSS" | "DAMAGE">;
  occurredAt?: Date;
  actorUserId: string;
}) {
  if (!input.reason.trim()) {
    throw new AdjustmentError("adjustments require a reason");
  }
  if (!Number.isInteger(input.quantity) || input.quantity === 0) {
    throw new AdjustmentError("adjustment quantity must be a non-zero integer");
  }

  const variant = await prisma.productVariant.findFirst({
    where: { id: input.productVariantId, deletedAt: null },
  });
  if (!variant) throw new AdjustmentError("variant not found");

  const type = input.type ?? "ADJUSTMENT";
  const result = await prisma.$transaction(async (tx) => {
    const applied = await persistInventoryTransaction(tx, {
      productVariantId: input.productVariantId,
      type,
      quantity: type === "ADJUSTMENT" || type === "COUNT" ? input.quantity : Math.abs(input.quantity),
      inboundDamage: false,
      referenceType: "Adjustment",
      reason: input.notes ? `${input.reason}: ${input.notes}` : input.reason,
      createdByUserId: input.actorUserId,
    });
    return applied;
  });

  await writeAuditLog(prisma, {
    actorUserId: input.actorUserId,
    action: "inventory.adjustment",
    entityType: "InventoryTransaction",
    entityId: result.txn.id,
    afterJson: {
      productVariantId: input.productVariantId,
      quantity: input.quantity,
      reason: input.reason,
      type,
      occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    },
  });
  return result;
}

export async function loadInventoryDashboard() {
  const variants = await prisma.productVariant.findMany({
    where: { deletedAt: null },
    include: {
      product: true,
      inventoryBalance: true,
      prices: true,
      costLayers: {
        where: { quantityRemaining: { gt: 0 } },
      },
    },
    orderBy: { sku: "asc" },
  });

  const rows = variants.map((variant) => {
    const balance = variant.inventoryBalance ?? {
      onHandQty: 0,
      reservedQty: 0,
      damagedQty: 0,
      inTransitQty: 0,
    };
    const available = availableQty(balance);
    const valueCents = variant.costLayers.reduce(
      (sum, layer) => sum + layer.quantityRemaining * layer.landedUnitCostCents,
      0,
    );
    const remainingUnits = variant.costLayers.reduce((sum, layer) => sum + layer.quantityRemaining, 0);
    const avgLandedCents =
      remainingUnits > 0 ? Math.round(valueCents / remainingUnits) : null;
    const retail = pickCurrentPrice(variant.prices, new Date(), "RETAIL");
    const retailCents = retail?.amountCents ?? null;
    const profitCents =
      retailCents !== null && avgLandedCents !== null
        ? grossProfitCents(retailCents, avgLandedCents)
        : null;
    const margin =
      retailCents !== null && avgLandedCents !== null && retailCents > 0
        ? marginPercent(retailCents, avgLandedCents)
        : null;
    return {
      variant,
      balance,
      available,
      valueCents,
      avgLandedCents,
      retailCents,
      profitCents,
      margin,
    };
  });

  const recommendations = reorderRecommendations(
    rows.map((row) => ({
      variantId: row.variant.id,
      sku: row.variant.sku,
      name: `${row.variant.product.name} — ${row.variant.name}`,
      reorderPoint: row.variant.reorderPoint,
      reorderQty: row.variant.reorderQty,
      balance: row.balance,
    })),
  );

  const totals = rows.reduce(
    (acc, row) => {
      acc.onHand += row.balance.onHandQty;
      acc.reserved += row.balance.reservedQty;
      acc.available += row.available;
      acc.valueCents += row.valueCents;
      if (row.available === 0) acc.outOfStock += 1;
      if (row.available > 0 && row.variant.reorderPoint !== null && row.available <= row.variant.reorderPoint) {
        acc.lowStock += 1;
      }
      return acc;
    },
    { onHand: 0, reserved: 0, available: 0, valueCents: 0, lowStock: 0, outOfStock: 0 },
  );

  return { rows, totals, recommendations };
}
