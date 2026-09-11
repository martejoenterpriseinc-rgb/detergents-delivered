import { availableQty } from "@/lib/domain/inventory";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { accountIdentity } from "./customer-account";
import { AccountError } from "@/lib/domain/account";
import { parseCatalogImport, catalogColumns } from "@/lib/domain/catalog-file";
import { writeCsv } from "@/lib/domain/csv";
type Tx = Prisma.TransactionClient;
export async function catalogFileAccess(tx: Tx, actor: string, write = false) {
  const user = await accountIdentity(tx, actor);
  const canWrite = user.userRoles.some((r) =>
    ["ADMIN", "SUPER_ADMIN", "INVENTORY"].includes(r.role.code),
  );
  if (!canWrite && (write || !user.userRoles.some((r) => r.role.code === "CPA")))
    throw new AccountError("Catalog file access required.", 403);
  return canWrite;
}
const input = z.object({ csv: z.string().max(12_000) }).strict();
const applyInput = input
  .extend({
    requestKey: z.string().uuid(),
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  })
  .strict();
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function conflicts(tx: Tx, rows: ReturnType<typeof parseCatalogImport>) {
  const [products, variants] = await Promise.all([
    tx.product.findMany({
      where: { slug: { in: rows.map((r) => r.productKey) } },
      select: { slug: true },
    }),
    tx.productVariant.findMany({
      where: {
        OR: rows.map((r) => ({ sku: { equals: r.sku, mode: "insensitive" as const } })),
      },
      select: { sku: true },
    }),
  ]);
  if (products.length || variants.length)
    throw new AccountError(
      "One or more product keys or SKUs already exist. This import only creates new draft products; no existing records were changed.",
      409,
    );
}
export async function previewCatalogFile(actor: string, raw: unknown) {
  await catalogFileAccess(prisma, actor, true);
  const rows = parseCatalogImport(input.parse(raw).csv);
  await conflicts(prisma, rows);
  return {
    rows,
    products: new Set(rows.map((r) => r.productKey)).size,
    variants: rows.length,
    previewHash: hash(rows),
  };
}
export async function applyCatalogFile(actor: string, raw: unknown) {
  const data = applyInput.parse(raw),
    rows = parseCatalogImport(data.csv),
    fingerprint = hash(rows);
  if (data.previewHash !== fingerprint)
    throw new AccountError("The file changed after review. Preview it again.", 409);
  const id = "catalog-import:" + hash([actor, data.requestKey]);
  return prisma.$transaction(
    async (tx) => {
      await catalogFileAccess(tx, actor, true);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('catalog-file-import', 0))`;
      const prior = await tx.auditLog.findUnique({ where: { id } });
      if (prior) {
        const saved = prior.afterJson as {
          fingerprint: string;
          products: number;
          variants: number;
        };
        if (saved.fingerprint !== fingerprint)
          throw new AccountError("This import key was used for different content.", 409);
        return { id, products: saved.products, variants: saved.variants };
      }
      await conflicts(tx, rows);
      const groups = new Map<string, typeof rows>();
      for (const row of rows)
        groups.set(row.productKey, [...(groups.get(row.productKey) ?? []), row]);
      const productIds: string[] = [];
      for (const [slug, variants] of groups) {
        const first = variants[0];
        const product = await tx.product.create({
          data: {
            slug,
            name: first.productName,
            brand: first.brand,
            taxCategory: first.taxCode,
            deliveryCapacityUnits: first.capacityUnits,
            isActive: false,
            websiteVisible: false,
            allowPreorder: false,
            variants: {
              create: variants.map((r) => ({
                sku: r.sku,
                name: r.variantName,
                taxCategory: r.taxCode,
                deliveryCapacityUnits: r.capacityUnits,
                isActive: false,
                websiteVisible: false,
                inventoryBalance: { create: {} },
                prices: {
                  create: {
                    kind: "RETAIL",
                    currency: "USD",
                    amountCents: r.amountCents,
                    startsAt: new Date(),
                  },
                },
              })),
            },
          },
        });
        productIds.push(product.id);
        await tx.auditLog.create({
          data: {
            actorUserId: actor,
            action: "catalog.import.product-created",
            entityType: "Product",
            entityId: product.id,
            afterJson: {
              batchId: id,
              variants: variants.length,
              published: false,
              active: false,
            },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          id,
          actorUserId: actor,
          action: "catalog.import.completed",
          entityType: "CatalogImport",
          entityId: id,
          afterJson: {
            fingerprint,
            products: productIds.length,
            variants: rows.length,
            productIds,
          },
        },
      });
      return { id, products: productIds.length, variants: rows.length };
    },
    { timeout: 20_000 },
  );
}
export async function exportCatalogFile(actor: string, raw: unknown) {
  const filter = z
    .object({
      kind: z.enum(["catalog", "stock", "template"]),
      prefix: z.string().max(80).default(""),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await catalogFileAccess(tx, actor);
      if (filter.kind === "template") return writeCsv([catalogColumns]);
      const now = new Date();
      const variants = await tx.productVariant.findMany({
        where: {
          deletedAt: null,
          product: { deletedAt: null },
          sku: { startsWith: filter.prefix, mode: "insensitive" },
        },
        include: {
          product: true,
          inventoryBalance: true,
          prices: {
            where: {
              kind: "RETAIL",
              currency: "USD",
              startsAt: { lte: now },
              OR: [{ endsAt: null }, { endsAt: { gt: now } }],
            },
            orderBy: [{ startsAt: "desc" }, { id: "asc" }],
            take: 2,
          },
        },
        orderBy: [{ sku: "asc" }, { id: "asc" }],
        take: 5001,
      });
      if (variants.length > 5000)
        throw new AccountError("Use a SKU prefix to export at most 5,000 variants.", 422);
      if (filter.kind === "stock")
        return writeCsv([
          [
            "sku",
            "product_name",
            "variant_name",
            "on_hand",
            "reserved",
            "available",
            "product_active",
            "variant_active",
          ],
          ...variants.map((v) => {
            const b = v.inventoryBalance;
            return [
              v.sku,
              v.product.name,
              v.name,
              b?.onHandQty ?? 0,
              b?.reservedQty ?? 0,
              availableQty({
                onHandQty: b?.onHandQty ?? 0,
                reservedQty: b?.reservedQty ?? 0,
                damagedQty: b?.damagedQty ?? 0,
                inTransitQty: b?.inTransitQty ?? 0,
              }),
              String(v.product.isActive),
              String(v.isActive),
            ];
          }),
        ]);
      return writeCsv([
        catalogColumns,
        ...variants.map((v) => [
          v.product.slug,
          v.product.name,
          v.product.brand,
          v.sku,
          v.name,
          v.prices.length === 1 ? (v.prices[0].amountCents / 100).toFixed(2) : "",
          v.taxCategory ?? v.product.taxCategory ?? "",
          v.deliveryCapacityUnits ?? v.product.deliveryCapacityUnits,
        ]),
      ]);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
