import type { Prisma, PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { documentNumber } from "@/lib/document-numbers";
import { allocateLandedCost } from "@/lib/domain/landed-cost";

export class PurchasingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchasingError";
  }
}

const OPEN_ORDERED: PurchaseOrderStatus[] = ["ORDERED", "SUBMITTED"];

export function isOrderedStatus(status: PurchaseOrderStatus) {
  return OPEN_ORDERED.includes(status);
}

export function canReceiveStatus(status: PurchaseOrderStatus) {
  return status === "ORDERED" || status === "SUBMITTED" || status === "PARTIALLY_RECEIVED";
}

function assertDraft(status: PurchaseOrderStatus) {
  if (status !== "DRAFT") {
    throw new PurchasingError("only draft purchase orders can be edited");
  }
}

export function poTotalsFromItems(
  items: Array<{
    id: string;
    quantityOrdered: number;
    unitCostCents: number;
    discountCents: number;
    freightCents: number;
    feeCents: number;
    taxCents: number;
    otherCostCents: number;
  }>,
  header: { freightCents: number; feeCents: number; taxCents: number; otherCostCents: number },
) {
  const allocation = allocateLandedCost(
    items.map((item) => ({
      id: item.id,
      quantity: item.quantityOrdered,
      unitCostCents: item.unitCostCents,
      discountCents: item.discountCents,
      freightCents: item.freightCents,
      feeCents: item.feeCents,
      taxCents: item.taxCents,
      otherCostCents: item.otherCostCents,
    })),
    header,
  );
  return {
    subtotalCents: allocation.merchandiseCents,
    landedCostCents: allocation.landedTotalCents,
    allocation,
  };
}

async function recomputePo(db: Prisma.TransactionClient, purchaseOrderId: string) {
  const po = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: { items: true },
  });
  const totals = poTotalsFromItems(po.items, {
    freightCents: po.freightCents,
    feeCents: po.feeCents,
    taxCents: po.taxCents,
    otherCostCents: po.otherCostCents,
  });
  return db.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: {
      subtotalCents: totals.subtotalCents,
      landedCostCents: totals.landedCostCents,
    },
    include: { items: true, vendor: true },
  });
}

export async function createPurchaseOrder(
  input: {
    vendorId: string;
    expectedAt?: Date | null;
    freightCents?: number;
    feeCents?: number;
    taxCents?: number;
    otherCostCents?: number;
    notes?: string | null;
    items?: Array<{
      productVariantId: string;
      quantityOrdered: number;
      unitCostCents: number;
      discountCents?: number;
      freightCents?: number;
      feeCents?: number;
      taxCents?: number;
      otherCostCents?: number;
    }>;
  },
  actorUserId?: string,
) {
  const vendor = await prisma.vendor.findFirst({
    where: { id: input.vendorId, deletedAt: null },
  });
  if (!vendor) throw new PurchasingError("vendor not found");

  const po = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        number: documentNumber("PO"),
        vendorId: input.vendorId,
        expectedAt: input.expectedAt ?? undefined,
        freightCents: input.freightCents ?? 0,
        feeCents: input.feeCents ?? 0,
        taxCents: input.taxCents ?? 0,
        otherCostCents: input.otherCostCents ?? 0,
        notes: input.notes,
        createdByUserId: actorUserId,
        items: input.items?.length
          ? {
              create: input.items.map((item) => ({
                productVariantId: item.productVariantId,
                quantityOrdered: item.quantityOrdered,
                unitCostCents: item.unitCostCents,
                discountCents: item.discountCents ?? 0,
                freightCents: item.freightCents ?? 0,
                feeCents: item.feeCents ?? 0,
                taxCents: item.taxCents ?? 0,
                otherCostCents: item.otherCostCents ?? 0,
                lineTotalCents:
                  item.quantityOrdered * item.unitCostCents - (item.discountCents ?? 0),
              })),
            }
          : undefined,
      },
    });
    return recomputePo(tx, created.id);
  });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "purchase_order.create",
    entityType: "PurchaseOrder",
    entityId: po.id,
    afterJson: { number: po.number, vendorId: po.vendorId },
  });
  return po;
}

export async function updatePurchaseOrder(
  id: string,
  input: {
    expectedAt?: Date | null;
    freightCents?: number;
    feeCents?: number;
    taxCents?: number;
    otherCostCents?: number;
    notes?: string | null;
  },
  actorUserId?: string,
) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) throw new PurchasingError("purchase order not found");
  assertDraft(existing.status);
  const po = await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        expectedAt: input.expectedAt,
        freightCents: input.freightCents,
        feeCents: input.feeCents,
        taxCents: input.taxCents,
        otherCostCents: input.otherCostCents,
        notes: input.notes,
      },
    });
    return recomputePo(tx, id);
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "purchase_order.update",
    entityType: "PurchaseOrder",
    entityId: id,
  });
  return po;
}

export async function addPurchaseOrderItem(
  purchaseOrderId: string,
  input: {
    productVariantId: string;
    quantityOrdered: number;
    unitCostCents: number;
    discountCents?: number;
    freightCents?: number;
    feeCents?: number;
    taxCents?: number;
    otherCostCents?: number;
  },
  actorUserId?: string,
) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
  if (!existing) throw new PurchasingError("purchase order not found");
  assertDraft(existing.status);
  const po = await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderItem.create({
      data: {
        purchaseOrderId,
        productVariantId: input.productVariantId,
        quantityOrdered: input.quantityOrdered,
        unitCostCents: input.unitCostCents,
        discountCents: input.discountCents ?? 0,
        freightCents: input.freightCents ?? 0,
        feeCents: input.feeCents ?? 0,
        taxCents: input.taxCents ?? 0,
        otherCostCents: input.otherCostCents ?? 0,
        lineTotalCents:
          input.quantityOrdered * input.unitCostCents - (input.discountCents ?? 0),
      },
    });
    return recomputePo(tx, purchaseOrderId);
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "purchase_order_item.create",
    entityType: "PurchaseOrder",
    entityId: purchaseOrderId,
  });
  return po;
}

export async function removePurchaseOrderItem(
  purchaseOrderId: string,
  itemId: string,
  actorUserId?: string,
) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
  if (!existing) throw new PurchasingError("purchase order not found");
  assertDraft(existing.status);
  const po = await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderItem.delete({ where: { id: itemId } });
    return recomputePo(tx, purchaseOrderId);
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "purchase_order_item.delete",
    entityType: "PurchaseOrder",
    entityId: purchaseOrderId,
  });
  return po;
}

export async function transitionPurchaseOrder(
  id: string,
  next: "ORDERED" | "CANCELLED",
  actorUserId?: string,
) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) throw new PurchasingError("purchase order not found");

  if (next === "ORDERED") {
    if (existing.status !== "DRAFT") {
      throw new PurchasingError("only draft purchase orders can be marked ordered");
    }
    const itemCount = await prisma.purchaseOrderItem.count({ where: { purchaseOrderId: id } });
    if (itemCount === 0) {
      throw new PurchasingError("add at least one line before ordering");
    }
  }
  if (next === "CANCELLED") {
    if (existing.status === "RECEIVED") {
      throw new PurchasingError("received purchase orders cannot be cancelled");
    }
  }

  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: next,
      orderedAt: next === "ORDERED" ? existing.orderedAt ?? new Date() : existing.orderedAt,
    },
    include: { items: true, vendor: true },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: `purchase_order.${next.toLowerCase()}`,
    entityType: "PurchaseOrder",
    entityId: id,
    beforeJson: { status: existing.status },
    afterJson: { status: po.status },
  });
  return po;
}

export async function refreshPurchaseOrderStatus(
  db: Prisma.TransactionClient,
  purchaseOrderId: string,
) {
  const po = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: { items: true },
  });
  if (po.status === "CANCELLED") return po;
  const anyReceived = po.items.some((item) => item.quantityReceived > 0);
  const allReceived =
    po.items.length > 0 &&
    po.items.every((item) => item.quantityReceived >= item.quantityOrdered);
  const next: PurchaseOrderStatus = allReceived
    ? "RECEIVED"
    : anyReceived
      ? "PARTIALLY_RECEIVED"
      : po.status;
  if (next === po.status) return po;
  return db.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status: next },
  });
}
