import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { availableQty } from "@/lib/domain/inventory";
import { createProduct, createVariant } from "@/lib/services/catalog";
import { persistInventoryTransaction } from "@/lib/services/inventory-ledger";
import { createPurchaseOrder, transitionPurchaseOrder } from "@/lib/services/purchasing";
import { receiveAgainstPurchaseOrder, ReceivingError } from "@/lib/services/receiving";
import { createVendor } from "@/lib/services/vendors";

const suffix = randomUUID().slice(0, 8);

describe("receiving integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("posts a receipt, ledger rows, cost layer, and on-hand balance", async () => {
    const vendor = await createVendor({ name: `IT Vendor ${suffix}` });
    const product = await createProduct({
      name: `IT Detergent ${suffix}`,
      brand: "IT Brand",
      slug: `it-detergent-${suffix}`,
    });
    const variant = await createVariant(product.id, {
      sku: `IT-SKU-${suffix}`,
      name: "64 oz test",
    });

    const po = await createPurchaseOrder({
      vendorId: vendor.id,
      freightCents: 100,
      items: [
        {
          productVariantId: variant.id,
          quantityOrdered: 10,
          unitCostCents: 200,
        },
      ],
    });
    await transitionPurchaseOrder(po.id, "ORDERED");

    const fresh = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: po.id },
      include: { items: true },
    });

    const receipt = await receiveAgainstPurchaseOrder({
      purchaseOrderId: fresh.id,
      lines: [
        {
          purchaseOrderItemId: fresh.items[0]!.id,
          quantityReceived: 8,
          quantityDamaged: 1,
          quantityShortage: 1,
        },
      ],
    });

    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { productVariantId: variant.id },
    });
    const txns = await prisma.inventoryTransaction.findMany({
      where: { productVariantId: variant.id },
    });
    const layers = await prisma.inventoryCostLayer.findMany({
      where: { productVariantId: variant.id },
    });
    const poAfter = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });

    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0]?.quantityReceived).toBe(8);
    expect(receipt.items[0]?.quantityDamaged).toBe(1);
    expect(receipt.items[0]?.landedUnitCostCents).toBeGreaterThan(200);
    expect(balance.onHandQty).toBe(8);
    expect(balance.damagedQty).toBe(1);
    expect(availableQty(balance)).toBe(8);
    expect(txns.some((txn) => txn.type === "PURCHASE_RECEIPT")).toBe(true);
    expect(txns.some((txn) => txn.type === "DAMAGE")).toBe(true);
    expect(layers[0]?.quantityRemaining).toBe(8);
    expect(poAfter.status).toBe("PARTIALLY_RECEIVED");
  });

  it("rejects an oversell reservation against the updated balance", async () => {
    const product = await createProduct({
      name: `IT Oversell ${suffix}`,
      brand: "IT Brand",
      slug: `it-oversell-${suffix}`,
    });
    const variant = await createVariant(product.id, {
      sku: `IT-OVER-${suffix}`,
      name: "tight stock",
    });

    await prisma.$transaction(async (tx) => {
      await persistInventoryTransaction(tx, {
        productVariantId: variant.id,
        type: "PURCHASE_RECEIPT",
        quantity: 2,
        reason: "integration setup",
      });
    });

    await expect(
      prisma.$transaction(async (tx) =>
        persistInventoryTransaction(tx, {
          productVariantId: variant.id,
          type: "CUSTOMER_RESERVATION",
          quantity: 3,
          reason: "should fail",
        }),
      ),
    ).rejects.toThrow(/oversell/);

    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { productVariantId: variant.id },
    });
    expect(balance.onHandQty).toBe(2);
    expect(balance.reservedQty).toBe(0);
  });

  it("rejects receiving a draft purchase order", async () => {
    const vendor = await createVendor({ name: `IT Draft ${suffix}` });
    const product = await createProduct({
      name: `IT Draft Product ${suffix}`,
      brand: "IT Brand",
      slug: `it-draft-${suffix}`,
    });
    const variant = await createVariant(product.id, {
      sku: `IT-DRAFT-${suffix}`,
      name: "draft line",
    });
    const po = await createPurchaseOrder({
      vendorId: vendor.id,
      items: [{ productVariantId: variant.id, quantityOrdered: 1, unitCostCents: 100 }],
    });
    await expect(
      receiveAgainstPurchaseOrder({
        purchaseOrderId: po.id,
        lines: [{ purchaseOrderItemId: po.items[0]!.id, quantityReceived: 1 }],
      }),
    ).rejects.toBeInstanceOf(ReceivingError);
  });
});
