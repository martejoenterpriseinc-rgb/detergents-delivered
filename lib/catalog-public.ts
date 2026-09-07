import { prisma } from "@/lib/prisma";
import { availableQty } from "@/lib/domain/inventory";
import { pickCurrentPrice } from "@/lib/prices";
import { canSeedDemoCatalog } from "@/lib/demo-mode";
import { ensureDemoCatalogOnBoot } from "@/lib/demo-boot";
import { isShopProductForm, type ShopProductForm } from "@/lib/product-display";

export type ShopFilters = {
  q?: string;
  form?: ShopProductForm;
  scent?: string;
  category?: string;
  inStock?: boolean;
};

function variantAvailable(balance: { onHandQty: number; reservedQty: number } | null) {
  if (!balance) return 0;
  return availableQty(balance);
}

export async function listShopProducts(filters: ShopFilters = {}) {
  if (canSeedDemoCatalog()) {
    await ensureDemoCatalogOnBoot();
  }

  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      websiteVisible: true,
      ...(filters.form && isShopProductForm(filters.form) ? { form: filters.form } : {}),
      ...(filters.scent
        ? {
            variants: {
              some: {
                scent: { equals: filters.scent, mode: "insensitive" },
                deletedAt: null,
              },
            },
          }
        : {}),
      ...(filters.category
        ? {
            category: {
              OR: [{ slug: filters.category }, { id: filters.category }],
              deletedAt: null,
            },
          }
        : {}),
      ...(filters.q
        ? {
            OR: [
              { name: { contains: filters.q, mode: "insensitive" } },
              {
                variants: {
                  some: {
                    OR: [
                      { sku: { contains: filters.q, mode: "insensitive" } },
                      { scent: { contains: filters.q, mode: "insensitive" } },
                      { sizeLabel: { contains: filters.q, mode: "insensitive" } },
                      { name: { contains: filters.q, mode: "insensitive" } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      category: true,
      images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
      variants: {
        where: { deletedAt: null, isActive: true, websiteVisible: true },
        include: {
          prices: true,
          inventoryBalance: true,
          images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
        },
        orderBy: { sku: "asc" },
      },
    },
    orderBy: [{ featured: "desc" }, { name: "asc" }],
  });

  return products
    .map((product) => {
      const variants = product.variants
        .map((variant) => {
          const available = variantAvailable(variant.inventoryBalance);
          return {
            ...variant,
            available,
            retailPrice: pickCurrentPrice(variant.prices, new Date(), "RETAIL"),
            salePrice: pickCurrentPrice(variant.prices, new Date(), "SALE"),
            subscriptionPrice: pickCurrentPrice(
              variant.prices,
              new Date(),
              "SUBSCRIPTION",
            ),
          };
        })
        .filter((variant) => product.allowPreorder || variant.available > 0);
      return { ...product, variants };
    })
    .filter((product) => product.variants.length > 0)
    .filter((product) =>
      filters.inStock ? product.variants.some((variant) => variant.available > 0) : true,
    );
}

export async function getShopProduct(slug: string) {
  const products = await listShopProducts();
  return products.find((product) => product.slug === slug) ?? null;
}

export async function listShopCategories() {
  return prisma.category.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function listFeaturedShopProducts(limit = 4) {
  const products = await listShopProducts();
  const featured = products.filter((product) => product.featured);
  return (featured.length > 0 ? featured : products).slice(0, limit);
}

export async function listShopForms() {
  const rows = await prisma.product.findMany({
    where: { deletedAt: null, isActive: true, websiteVisible: true },
    distinct: ["form"],
    select: { form: true },
    orderBy: { form: "asc" },
  });
  return rows.map((row) => row.form);
}

export async function listShopScents() {
  const rows = await prisma.productVariant.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      websiteVisible: true,
      scent: { not: null },
      product: { deletedAt: null, isActive: true, websiteVisible: true },
    },
    distinct: ["scent"],
    select: { scent: true },
    orderBy: { scent: "asc" },
  });
  return rows.map((row) => row.scent).filter((scent): scent is string => Boolean(scent));
}
