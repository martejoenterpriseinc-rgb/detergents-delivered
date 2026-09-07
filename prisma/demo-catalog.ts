import type { PrismaClient, ProductForm } from "@prisma/client";
import {
  DEMO_CATEGORIES,
  DEMO_PRODUCTS,
  DEMO_VENDOR,
  type DemoProductSpec,
} from "../lib/demo-catalog-data";
import {
  createCategory,
  createProduct,
  createProductPrice,
  createVariant,
  updateProduct,
} from "../lib/services/catalog";
import { createVendor } from "../lib/services/vendors";
import { createPurchaseOrder, transitionPurchaseOrder } from "../lib/services/purchasing";
import { receiveAgainstPurchaseOrder } from "../lib/services/receiving";

async function ensureVendor(prisma: PrismaClient, actorUserId?: string) {
  const existing = await prisma.vendor.findFirst({
    where: { name: DEMO_VENDOR.name, deletedAt: null },
  });
  if (existing) return existing;
  return createVendor({ ...DEMO_VENDOR }, actorUserId);
}

async function ensureCategories(prisma: PrismaClient, actorUserId?: string) {
  const bySlug = new Map<string, string>();
  for (const spec of DEMO_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { slug: spec.slug, deletedAt: null },
    });
    if (existing) {
      bySlug.set(spec.slug, existing.id);
      continue;
    }
    const created = await createCategory(
      {
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        parentId: spec.parentSlug ? bySlug.get(spec.parentSlug) : undefined,
      },
      actorUserId,
    );
    bySlug.set(spec.slug, created.id);
  }
  return bySlug;
}

async function ensureProduct(
  prisma: PrismaClient,
  spec: DemoProductSpec,
  categoryId: string | undefined,
  actorUserId?: string,
) {
  const existingVariants = await prisma.productVariant.findMany({
    where: { sku: { in: spec.variants.map((variant) => variant.sku) } },
  });
  const existingBySku = new Map(
    existingVariants.map((variant) => [variant.sku, variant]),
  );
  const missing = spec.variants.filter((variant) => !existingBySku.has(variant.sku));

  let product = await prisma.product.findFirst({
    where: { slug: spec.slug, deletedAt: null },
  });

  if (!product && missing.length === 0) {
    const ownerId = existingVariants[0]?.productId;
    product = ownerId
      ? await prisma.product.findFirst({ where: { id: ownerId, deletedAt: null } })
      : null;
    return {
      product,
      variants: existingVariants.map((variant) => ({
        variant,
        spec: spec.variants.find((item) => item.sku === variant.sku)!,
      })),
    };
  }

  if (!product) {
    product = await createProduct(
      {
        name: spec.name,
        brand: spec.brand,
        slug: spec.slug,
        description: spec.description,
        categoryId,
        form: spec.form as ProductForm,
        taxCategory: "TAXABLE",
        websiteVisible: false,
        isActive: true,
        featured: spec.featured,
      },
      actorUserId,
    );
  } else {
    await updateProduct(
      product.id,
      {
        name: spec.name,
        brand: spec.brand,
        description: spec.description,
        categoryId,
        form: spec.form as ProductForm,
        featured: spec.featured,
        isActive: true,
      },
      actorUserId,
    );
  }

  const variants = existingVariants
    .filter((variant) => variant.productId === product!.id)
    .map((variant) => ({
      variant,
      spec: spec.variants.find((item) => item.sku === variant.sku)!,
    }));

  for (const variantSpec of missing) {
    const variant = await createVariant(
      product.id,
      {
        sku: variantSpec.sku,
        upc: variantSpec.upc,
        name: variantSpec.name,
        scent: variantSpec.scent,
        sizeLabel: variantSpec.sizeLabel,
        sizeValue: variantSpec.sizeValue,
        sizeUnit: variantSpec.sizeUnit,
        uom: variantSpec.uom,
        casePack: variantSpec.casePack,
        reorderPoint: variantSpec.reorderPoint,
        reorderQty: variantSpec.reorderQty,
      },
      actorUserId,
    );
    await createProductPrice(
      variant.id,
      { amountCents: variantSpec.retailCents, kind: "RETAIL" },
      actorUserId,
    );
    await createProductPrice(
      variant.id,
      { amountCents: variantSpec.subscriptionCents, kind: "SUBSCRIPTION" },
      actorUserId,
    );
    variants.push({ variant, spec: variantSpec });
  }

  return { product, variants };
}

async function receiveMissingStock(
  prisma: PrismaClient,
  vendorId: string,
  variantIds: string[],
  costByVariantId: Map<string, number>,
  actorUserId?: string,
) {
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, deletedAt: null },
    include: { inventoryBalance: true },
  });
  const needsStock = variants.filter(
    (variant) => !variant.inventoryBalance || variant.inventoryBalance.onHandQty === 0,
  );
  if (needsStock.length === 0) return;

  const po = await createPurchaseOrder(
    {
      vendorId,
      freightCents: 1800,
      feeCents: 300,
      notes: "Demo storefront starter load",
      items: needsStock.map((variant) => ({
        productVariantId: variant.id,
        quantityOrdered: 18,
        unitCostCents: costByVariantId.get(variant.id) ?? 650,
      })),
    },
    actorUserId,
  );
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
}

export async function seedDemoCatalog(prisma: PrismaClient, actorUserId?: string) {
  const vendor = await ensureVendor(prisma, actorUserId);
  const categories = await ensureCategories(prisma, actorUserId);

  const costByVariantId = new Map<string, number>();
  const variantIds: string[] = [];
  const productIds: string[] = [];

  for (const spec of DEMO_PRODUCTS) {
    const { product, variants } = await ensureProduct(
      prisma,
      spec,
      categories.get(spec.categorySlug),
      actorUserId,
    );
    if (!product) continue;
    productIds.push(product.id);
    for (const row of variants) {
      if (!row.spec) continue;
      variantIds.push(row.variant.id);
      costByVariantId.set(row.variant.id, row.spec.unitCostCents);
    }
  }

  await receiveMissingStock(prisma, vendor.id, variantIds, costByVariantId, actorUserId);

  for (const productId of productIds) {
    await updateProduct(productId, { websiteVisible: true, isActive: true }, actorUserId);
  }

  // Legacy single-product seed from Phase 2 still works if it already exists.
  const legacy = await prisma.product.findFirst({
    where: { slug: "house-detergent-lineup", deletedAt: null },
  });
  if (legacy && !legacy.websiteVisible) {
    await updateProduct(legacy.id, { websiteVisible: true, featured: true }, actorUserId);
  }

  console.log(
    `Demo catalog ready: ${DEMO_PRODUCTS.length} household products published to /shop`,
  );
  return {
    productCount: DEMO_PRODUCTS.length,
    vendorId: vendor.id,
    productIds,
  };
}

export async function countVisibleShopProducts(prisma: PrismaClient) {
  return prisma.product.count({
    where: { deletedAt: null, isActive: true, websiteVisible: true },
  });
}
