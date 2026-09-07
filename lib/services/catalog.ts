import type { PriceKind, Prisma, ProductForm } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { slugify } from "@/lib/slug";

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>) {
  const root = slugify(base);
  if (!(await exists(root))) return root;
  for (let i = 2; i < 50; i += 1) {
    const candidate = `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new CatalogError("could not allocate a unique slug");
}

async function assertCategoryParent(parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) {
    throw new CatalogError("a category cannot be its own parent");
  }
  let cursor: string | null = parentId;
  const seen = new Set<string>(selfId ? [selfId] : []);
  while (cursor) {
    if (seen.has(cursor)) {
      throw new CatalogError("category tree cycle is not allowed");
    }
    seen.add(cursor);
    const parent: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!parent) {
      throw new CatalogError("parent category not found");
    }
    cursor = parent.parentId;
  }
}

export async function createCategory(
  input: {
    name: string;
    slug?: string;
    description?: string;
    parentId?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  },
  actorUserId?: string,
) {
  await assertCategoryParent(input.parentId);
  const slug = input.slug
    ? slugify(input.slug)
    : await uniqueSlug(input.name, async (value) =>
        Boolean(await prisma.category.findUnique({ where: { slug: value } })),
      );
  const category = await prisma.category.create({
    data: {
      name: input.name,
      slug,
      description: input.description,
      parentId: input.parentId ?? undefined,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "category.create",
    entityType: "Category",
    entityId: category.id,
    afterJson: category as unknown as Prisma.InputJsonValue,
  });
  return category;
}

export async function updateCategory(
  id: string,
  input: {
    name?: string;
    slug?: string;
    description?: string | null;
    parentId?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  },
  actorUserId?: string,
) {
  const existing = await prisma.category.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new CatalogError("category not found");
  if (input.parentId !== undefined) {
    await assertCategoryParent(input.parentId, id);
  }
  const category = await prisma.category.update({
    where: { id },
    data: {
      name: input.name,
      slug: input.slug ? slugify(input.slug) : undefined,
      description: input.description,
      parentId: input.parentId,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "category.update",
    entityType: "Category",
    entityId: id,
    beforeJson: existing as unknown as Prisma.InputJsonValue,
    afterJson: category as unknown as Prisma.InputJsonValue,
  });
  return category;
}

export async function deleteCategory(id: string, actorUserId?: string) {
  const existing = await prisma.category.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new CatalogError("category not found");
  const child = await prisma.category.findFirst({
    where: { parentId: id, deletedAt: null },
  });
  if (child) {
    throw new CatalogError("reassign or delete subcategories first");
  }
  const category = await prisma.category.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "category.delete",
    entityType: "Category",
    entityId: id,
    beforeJson: existing as unknown as Prisma.InputJsonValue,
  });
  return category;
}

export async function createProduct(
  input: {
    name: string;
    brand: string;
    slug?: string;
    description?: string;
    categoryId?: string | null;
    form?: ProductForm;
    taxCategory?: string | null;
    deliveryCapacityUnits?: number;
    allowPreorder?: boolean;
    isActive?: boolean;
    websiteVisible?: boolean;
    featured?: boolean;
  },
  actorUserId?: string,
) {
  const slug = input.slug
    ? slugify(input.slug)
    : await uniqueSlug(input.name, async (value) =>
        Boolean(await prisma.product.findUnique({ where: { slug: value } })),
      );
  const product = await prisma.product.create({
    data: {
      name: input.name,
      brand: input.brand,
      slug,
      description: input.description,
      categoryId: input.categoryId ?? undefined,
      form: input.form ?? "OTHER",
      taxCategory: input.taxCategory,
      deliveryCapacityUnits: input.deliveryCapacityUnits ?? 1,
      allowPreorder: input.allowPreorder ?? false,
      isActive: input.isActive ?? true,
      websiteVisible: input.websiteVisible ?? false,
      featured: input.featured ?? false,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "product.create",
    entityType: "Product",
    entityId: product.id,
    afterJson: { id: product.id, slug: product.slug },
  });
  return product;
}

export async function updateProduct(
  id: string,
  input: {
    name?: string;
    brand?: string;
    slug?: string;
    description?: string | null;
    categoryId?: string | null;
    form?: ProductForm;
    taxCategory?: string | null;
    deliveryCapacityUnits?: number;
    allowPreorder?: boolean;
    isActive?: boolean;
    websiteVisible?: boolean;
    featured?: boolean;
  },
  actorUserId?: string,
) {
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new CatalogError("product not found");
  const product = await prisma.product.update({
    where: { id },
    data: {
      ...input,
      slug: input.slug ? slugify(input.slug) : undefined,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "product.update",
    entityType: "Product",
    entityId: id,
    beforeJson: { name: existing.name, websiteVisible: existing.websiteVisible },
    afterJson: { name: product.name, websiteVisible: product.websiteVisible },
  });
  return product;
}

export async function deleteProduct(id: string, actorUserId?: string) {
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new CatalogError("product not found");
  const product = await prisma.product.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, websiteVisible: false },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "product.delete",
    entityType: "Product",
    entityId: id,
  });
  return product;
}

export async function createVariant(
  productId: string,
  input: {
    sku: string;
    name: string;
    upc?: string | null;
    scent?: string | null;
    sizeLabel?: string | null;
    sizeValue?: number | null;
    sizeUnit?: string | null;
    weightValue?: number | null;
    weightUnit?: string | null;
    lengthIn?: number | null;
    widthIn?: number | null;
    heightIn?: number | null;
    uom?: string | null;
    casePack?: number | null;
    taxCategory?: string | null;
    reorderPoint?: number | null;
    reorderQty?: number | null;
    deliveryCapacityUnits?: number | null;
    isActive?: boolean;
    websiteVisible?: boolean;
    featured?: boolean;
  },
  actorUserId?: string,
) {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) throw new CatalogError("product not found");
  const variant = await prisma.productVariant.create({
    data: {
      productId,
      sku: input.sku.trim(),
      name: input.name,
      upc: input.upc || null,
      scent: input.scent,
      sizeLabel: input.sizeLabel,
      sizeValue: input.sizeValue ?? undefined,
      sizeUnit: input.sizeUnit,
      weightValue: input.weightValue ?? undefined,
      weightUnit: input.weightUnit,
      lengthIn: input.lengthIn ?? undefined,
      widthIn: input.widthIn ?? undefined,
      heightIn: input.heightIn ?? undefined,
      uom: input.uom,
      casePack: input.casePack,
      taxCategory: input.taxCategory,
      reorderPoint: input.reorderPoint,
      reorderQty: input.reorderQty,
      deliveryCapacityUnits: input.deliveryCapacityUnits,
      isActive: input.isActive ?? true,
      websiteVisible: input.websiteVisible ?? true,
      featured: input.featured ?? false,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "variant.create",
    entityType: "ProductVariant",
    entityId: variant.id,
    afterJson: { sku: variant.sku, productId },
  });
  return variant;
}

export async function updateVariant(
  id: string,
  input: Partial<Parameters<typeof createVariant>[1]>,
  actorUserId?: string,
) {
  const existing = await prisma.productVariant.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new CatalogError("variant not found");
  const variant = await prisma.productVariant.update({
    where: { id },
    data: {
      ...input,
      sku: input.sku?.trim(),
      upc: input.upc === undefined ? undefined : input.upc || null,
      sizeValue: input.sizeValue ?? undefined,
      weightValue: input.weightValue ?? undefined,
      lengthIn: input.lengthIn ?? undefined,
      widthIn: input.widthIn ?? undefined,
      heightIn: input.heightIn ?? undefined,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "variant.update",
    entityType: "ProductVariant",
    entityId: id,
    beforeJson: { sku: existing.sku },
    afterJson: { sku: variant.sku },
  });
  return variant;
}

export async function deleteVariant(id: string, actorUserId?: string) {
  const existing = await prisma.productVariant.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new CatalogError("variant not found");
  const variant = await prisma.productVariant.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, websiteVisible: false },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "variant.delete",
    entityType: "ProductVariant",
    entityId: id,
  });
  return variant;
}

/** Insert a new price row. Historical amounts are never updated in place. */
export async function createProductPrice(
  productVariantId: string,
  input: {
    amountCents: number;
    kind?: PriceKind;
    startsAt?: Date;
    endsAt?: Date | null;
    currency?: string;
  },
  actorUserId?: string,
) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: productVariantId, deletedAt: null },
  });
  if (!variant) throw new CatalogError("variant not found");
  const price = await prisma.productPrice.create({
    data: {
      productVariantId,
      amountCents: input.amountCents,
      kind: input.kind ?? "RETAIL",
      startsAt: input.startsAt ?? new Date(),
      endsAt: input.endsAt ?? null,
      currency: input.currency ?? "USD",
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "price.create",
    entityType: "ProductPrice",
    entityId: price.id,
    afterJson: {
      productVariantId,
      kind: price.kind,
      amountCents: price.amountCents,
      startsAt: price.startsAt.toISOString(),
    },
  });
  return price;
}

export async function addProductImage(
  input: {
    productId?: string;
    productVariantId?: string;
    storageKey: string;
    alt?: string;
    sortOrder?: number;
    isPrimary?: boolean;
  },
  actorUserId?: string,
) {
  if (!input.productId && !input.productVariantId) {
    throw new CatalogError("image must belong to a product or variant");
  }
  if (input.isPrimary) {
    await prisma.productImage.updateMany({
      where: {
        productId: input.productId ?? undefined,
        productVariantId: input.productVariantId ?? undefined,
      },
      data: { isPrimary: false },
    });
  }
  const image = await prisma.productImage.create({
    data: {
      productId: input.productId,
      productVariantId: input.productVariantId,
      storageKey: input.storageKey,
      alt: input.alt,
      sortOrder: input.sortOrder ?? 0,
      isPrimary: input.isPrimary ?? false,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "image.create",
    entityType: "ProductImage",
    entityId: image.id,
    afterJson: { storageKey: image.storageKey },
  });
  return image;
}
