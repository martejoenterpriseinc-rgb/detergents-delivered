import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { documentNumber } from "@/lib/document-numbers";
import { allocateLandedCost } from "@/lib/domain/landed-cost";
import { InventoryError } from "@/lib/domain/inventory";
import { persistInventoryTransaction } from "@/lib/services/inventory-ledger";
import { canReceiveStatus, refreshPurchaseOrderStatus } from "@/lib/services/purchasing";

export class ReceivingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceivingError";
  }
}

export type ReceiveLineInput = {
  purchaseOrderItemId: string;
  quantityReceived: number;
  quantityDamaged?: number;
  quantityShortage?: number;
  quantityOverage?: number;
  unitCostCents?: number;
  costDiscrepancyNotes?: string | null;
};

export async function receiveAgainstPurchaseOrder(
  input: {
    purchaseOrderId: string;
    notes?: string | null;
    receivedAt?: Date;
    lines: ReceiveLineInput[];
  },
  actorUserId?: string,
) {
  if (input.lines.length === 0) {
    throw new ReceivingError("receive at least one line");
  }

  try {
    const receipt = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: input.purchaseOrderId },
        include: { items: true },
      });
      if (!po) throw new ReceivingError("purchase order not found");
      if (!canReceiveStatus(po.status)) {
        throw new ReceivingError(`cannot receive a purchase order in ${po.status} status`);
      }

      const allocation = allocateLandedCost(
        po.items.map((item) => ({
          id: item.id,
          quantity: item.quantityOrdered,
          unitCostCents: item.unitCostCents,
          discountCents: item.discountCents,
          freightCents: item.freightCents,
          feeCents: item.feeCents,
          taxCents: item.taxCents,
          otherCostCents: item.otherCostCents,
        })),
        {
          freightCents: po.freightCents,
          feeCents: po.feeCents,
          taxCents: po.taxCents,
          otherCostCents: po.otherCostCents,
        },
      );
      const landedByItem = new Map(
        allocation.lines.map((line) => [line.id, line.landedUnitCostCents]),
      );

      const created = await tx.receipt.create({
        data: {
          number: documentNumber("RCV"),
          purchaseOrderId: po.id,
          receivedAt: input.receivedAt ?? new Date(),
          notes: input.notes,
          createdByUserId: actorUserId,
        },
      });

      for (const line of input.lines) {
        const poItem = po.items.find((item) => item.id === line.purchaseOrderItemId);
        if (!poItem) {
          throw new ReceivingError("purchase order line not found on this PO");
        }
        const good = line.quantityReceived;
        const damaged = line.quantityDamaged ?? 0;
        const shortage = line.quantityShortage ?? 0;
        const overage = line.quantityOverage ?? 0;
        if (![good, damaged, shortage, overage].every((qty) => Number.isInteger(qty) && qty >= 0)) {
          throw new ReceivingError("receive quantities must be non-negative integers");
        }
        if (good + damaged + shortage + overage === 0) {
          throw new ReceivingError("each receive line must include a quantity");
        }

        const unitCostCents = line.unitCostCents ?? poItem.unitCostCents;
        const landedUnitCostCents = landedByItem.get(poItem.id) ?? unitCostCents;
        const physical = good + damaged;

        const receiptItem = await tx.receiptItem.create({
          data: {
            receiptId: created.id,
            purchaseOrderItemId: poItem.id,
            productVariantId: poItem.productVariantId,
            quantityReceived: good,
            quantityDamaged: damaged,
            quantityShortage: shortage,
            quantityOverage: overage,
            unitCostCents,
            landedUnitCostCents,
            costDiscrepancyNotes: line.costDiscrepancyNotes,
          },
        });

        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { quantityReceived: poItem.quantityReceived + good + damaged },
        });

        if (good > 0) {
          await persistInventoryTransaction(tx, {
            productVariantId: poItem.productVariantId,
            type: "PURCHASE_RECEIPT",
            quantity: good,
            referenceType: "ReceiptItem",
            referenceId: receiptItem.id,
            reason: "purchase receipt",
            createdByUserId: actorUserId,
          });
          await tx.inventoryCostLayer.create({
            data: {
              productVariantId: poItem.productVariantId,
              receiptItemId: receiptItem.id,
              quantityOriginal: good,
              quantityRemaining: good,
              landedUnitCostCents,
              receivedAt: created.receivedAt,
            },
          });
        }

        if (damaged > 0) {
          await persistInventoryTransaction(tx, {
            productVariantId: poItem.productVariantId,
            type: "DAMAGE",
            quantity: damaged,
            inboundDamage: true,
            referenceType: "ReceiptItem",
            referenceId: receiptItem.id,
            reason: "inbound damage",
            createdByUserId: actorUserId,
          });
        }

        if (physical > 0) {
          await tx.vendorProduct.upsert({
            where: {
              vendorId_productVariantId: {
                vendorId: po.vendorId,
                productVariantId: poItem.productVariantId,
              },
            },
            update: { unitCostCents: landedUnitCostCents },
            create: {
              vendorId: po.vendorId,
              productVariantId: poItem.productVariantId,
              unitCostCents: landedUnitCostCents,
            },
          });
        }
      }

      await refreshPurchaseOrderStatus(tx, po.id);
      return tx.receipt.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          items: true,
          purchaseOrder: { include: { items: true, vendor: true } },
        },
      });
    });

    await writeAuditLog(prisma, {
      actorUserId,
      action: "receipt.create",
      entityType: "Receipt",
      entityId: receipt.id,
      afterJson: {
        number: receipt.number,
        purchaseOrderId: receipt.purchaseOrderId,
        lines: receipt.items.length,
      },
    });
    return receipt;
  } catch (error) {
    if (error instanceof InventoryError) {
      throw new ReceivingError(error.message);
    }
    throw error;
  }
}
