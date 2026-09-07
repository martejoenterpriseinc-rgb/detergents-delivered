import type { PrismaClient } from "@prisma/client";
import { createCategory, createProduct, createProductPrice, createVariant, updateProduct } from "../lib/services/catalog";
import { createVendor } from "../lib/services/vendors";
import { addPurchaseOrderItem, createPurchaseOrder, transitionPurchaseOrder } from "../lib/services/purchasing";
import { receiveAgainstPurchaseOrder } from "../lib/services/receiving";

const VARIANTS = [
  {
    sku: "DD-LIQ-64-FRESH",
    upc: "000000000001",
    name: "64 oz Fresh Breeze",
    scent: "Fresh Breeze",
    sizeLabel: "64 oz",
    sizeValue: 64,
    sizeUnit: "oz",
    uom: "bottle",
    casePack: 6,
    reorderPoint: 6,
    reorderQty: 12,
    unitCostCents: 650,
    retailCents: 1299,
    subscriptionCents: 1199,
  },
  {
    sku: "DD-LIQ-100-LAV",
    upc: "000000000002",
    name: "100 oz Lavender",
    scent: "Lavender",
    sizeLabel: "100 oz",
    sizeValue: 100,
    sizeUnit: "oz",
    uom: "bottle",
    casePack: 4,
    reorderPoint: 4,
    reorderQty: 8,
    unitCostCents: 890,
    retailCents: 1699,
    subscriptionCents: 1549,
  },
  {
    sku: "DD-POD-42-FREE",
    upc: "000000000003",
    name: "42-count Free & Clear pods",
    scent: "Free & Clear",
    sizeLabel: "42 ct",
    sizeValue: 42,
    sizeUnit: "ct",
    uom: "tub",
    casePack: 6,
    reorderPoint: 8,
    reorderQty: 12,
    unitCostCents: 720,
    retailCents: 1499,
    subscriptionCents: 1399,
  },
  {
    sku: "DD-PWD-93-ORIG",
    upc: "000000000004",
    name: "93 oz Original powder",
    scent: "Original",
    sizeLabel: "93 oz",
    sizeValue: 93,
    sizeUnit: "oz",
    uom: "box",
    casePack: 3,
    reorderPoint: 3,
    reorderQty: 6,
    unitCostCents: 540,
    retailCents: 1099,
    subscriptionCents: 999,
  },
] as const;

export async function seedDemoCatalog(prisma: PrismaClient, actorUserId?: string) {
  const existing = await prisma.productVariant.findUnique({
    where: { sku: VARIANTS[0].sku },
  });
  if (existing) {
    console.log("Demo catalog already present — skipping recreate.");
    return { reused: true, productId: existing.productId };
  }

  const vendor = await createVendor(
    {
      name: "Midwest Household Supply",
      contactName: "Alex Rivera",
      email: "orders@midwest-household.example",
      phone: "555-0100",
      addressLine1: "100 Warehouse Rd",
      city: "Des Moines",
      region: "IA",
      postalCode: "50309",
      paymentTerms: "Net 15",
      notes: "Primary detergent wholesaler for the demo path.",
    },
    actorUserId,
  );

  const laundry = await createCategory(
    { name: "Laundry", slug: "laundry", description: "Detergent and wash-day supplies" },
    actorUserId,
  );
  await createCategory(
    { name: "Liquid detergent", slug: "liquid-detergent", parentId: laundry.id },
    actorUserId,
  );

  const product = await createProduct(
    {
      name: "House detergent lineup",
      brand: "Detergents Delivered",
      slug: "house-detergent-lineup",
      description: "Core liquids, pods, and powder stocked for local delivery.",
      categoryId: laundry.id,
      form: "OTHER",
      taxCategory: "TAXABLE",
      websiteVisible: false,
      isActive: true,
    },
    actorUserId,
  );

  const createdVariants = [];
  for (const spec of VARIANTS) {
    const variant = await createVariant(
      product.id,
      {
        sku: spec.sku,
        upc: spec.upc,
        name: spec.name,
        scent: spec.scent,
        sizeLabel: spec.sizeLabel,
        sizeValue: spec.sizeValue,
        sizeUnit: spec.sizeUnit,
        uom: spec.uom,
        casePack: spec.casePack,
        reorderPoint: spec.reorderPoint,
        reorderQty: spec.reorderQty,
      },
      actorUserId,
    );
    await createProductPrice(variant.id, { amountCents: spec.retailCents, kind: "RETAIL" }, actorUserId);
    await createProductPrice(
      variant.id,
      { amountCents: spec.subscriptionCents, kind: "SUBSCRIPTION" },
      actorUserId,
    );
    createdVariants.push({ variant, spec });
  }

  const po = await createPurchaseOrder(
    {
      vendorId: vendor.id,
      freightCents: 1200,
      feeCents: 200,
      notes: "Demo starter load",
    },
    actorUserId,
  );

  for (const row of createdVariants) {
    await addPurchaseOrderItem(
      po.id,
      {
        productVariantId: row.variant.id,
        quantityOrdered: 12,
        unitCostCents: row.spec.unitCostCents,
      },
      actorUserId,
    );
  }

  await transitionPurchaseOrder(po.id, "ORDERED", actorUserId);

  const ordered = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: po.id },
    include: { items: true },
  });

  await receiveAgainstPurchaseOrder(
    {
      purchaseOrderId: ordered.id,
      notes: "Demo full receipt",
      lines: ordered.items.map((item) => ({
        purchaseOrderItemId: item.id,
        quantityReceived: item.quantityOrdered,
      })),
    },
    actorUserId,
  );

  await updateProduct(product.id, { websiteVisible: true, featured: true }, actorUserId);

  console.log("Demo catalog seeded: vendor → variants → PO → receive → /shop");
  return { reused: false, productId: product.id, vendorId: vendor.id, purchaseOrderId: po.id };
}
