import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { loadKinds } from "@/lib/domain/launch";
import { accountIdentity } from "./customer-account";
import { saveCatalogImage } from "./catalog-images";
export { catalogUploadReady } from "./catalog-images";
import { slugify } from "@/lib/slug";
export const shopEntrySchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(5000),
    sku: z.string().trim().min(1).max(80),
    priceCents: z.number().int().min(1).max(1000000),
    retailCents: z.number().int().min(1).max(1000000),
    loadKind: z.enum(loadKinds),
    deliveryCapacityUnits: z.number().int().min(1).max(1000),
    publish: z.boolean(),
    requestKey: z.uuid(),
  })
  .strict()
  .refine(
    (v) => v.retailCents >= v.priceCents,
    "Retail comparison price must be at least the selling price.",
  );
export async function addShopEntry(userId: string, input: unknown, image?: Buffer) {
  const data = shopEntrySchema.parse(input);
  const hash = createHash("sha256")
    .update(JSON.stringify(data))
    .update(image ?? Buffer.alloc(0))
    .digest("hex");
  return prisma.$transaction(
    async (tx) => {
      const user = await accountIdentity(tx, userId, true);
      if (
        !user.userRoles.some(({ role }) =>
          ["ADMIN", "INVENTORY", "SUPER_ADMIN"].includes(role.code),
        )
      )
        throw new AccountError("Catalog manager access required.", 403);
      const prior = await tx.auditLog.findFirst({
        where: {
          actorUserId: userId,
          action: "shop.entry.created",
          afterJson: { path: ["requestKey"], equals: data.requestKey },
        },
      });
      if (prior) {
        const saved = prior.afterJson as { hash: string; productId: string };
        if (saved.hash !== hash)
          throw new AccountError(
            "This request was already used for different product details.",
            409,
          );
        return { id: saved.productId };
      }
      if (await tx.productVariant.findUnique({ where: { sku: data.sku } }))
        throw new AccountError(
          "This SKU already exists. Edit its product or receive inventory against it.",
          409,
        );
      let storageKey: string | undefined;
      if (image?.length) storageKey = (await saveCatalogImage(image)).storageKey;
      const product = await tx.product.create({
        data: {
          name: data.title,
          brand: "Detergents Delivered",
          description: data.description,
          slug: `${slugify(data.title).slice(0, 60)}-${data.requestKey}`,
          loadKind: data.loadKind,
          deliveryCapacityUnits: data.deliveryCapacityUnits,
          websiteVisible: data.publish,
          allowPreorder: false,
          variants: {
            create: {
              sku: data.sku,
              name: data.title,
              deliveryCapacityUnits: data.deliveryCapacityUnits,
              prices: {
                create: [
                  { kind: "RETAIL", amountCents: data.retailCents, startsAt: new Date() },
                  { kind: "SALE", amountCents: data.priceCents, startsAt: new Date() },
                ],
              },
            },
          },
          ...(storageKey
            ? { images: { create: { storageKey, alt: data.title, isPrimary: true } } }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "shop.entry.created",
          entityType: "Product",
          entityId: product.id,
          afterJson: { requestKey: data.requestKey, hash, productId: product.id },
        },
      });
      // Quantities only enter through the receiving ledger; a catalog entry is not stock.
      return { id: product.id };
    },
    { timeout: 15000 },
  );
}
