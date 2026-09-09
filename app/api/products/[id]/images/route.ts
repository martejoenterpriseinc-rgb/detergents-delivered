import { prisma } from "@/lib/prisma";
import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import { accountIdentity } from "@/lib/services/customer-account";
import { saveCatalogImage } from "@/lib/services/catalog-images";
import { boundedImageForm } from "@/lib/multipart-form";
import { createHash } from "node:crypto";
import { z } from "zod";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await accountRequest();
    const user = await accountIdentity(prisma, userId);
    if (
      !user.userRoles.some(({ role }) =>
        ["ADMIN", "INVENTORY", "SUPER_ADMIN"].includes(role.code),
      )
    )
      throw new AccountError("Catalog manager access required.", 403);
    const { id } = await params;
    const form = await boundedImageForm(request);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new AccountError("Select an image.");
    const requestKey = z.uuid().parse(form.get("requestKey"));
    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = createHash("sha256").update(id).update(bytes).digest("hex");
    const image = await prisma.$transaction(
      async (tx) => {
        const requestLock = `catalog-upload:${userId}:${requestKey}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestLock}, 0))`;
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${id} FOR UPDATE`;
        const product = await tx.product.findFirst({ where: { id, deletedAt: null } });
        if (!product) throw new AccountError("Product not found.", 404);
        const prior = await tx.auditLog.findFirst({
          where: {
            actorUserId: userId,
            action: "catalog.image.saved",
            afterJson: { path: ["requestKey"], equals: requestKey },
          },
        });
        if (prior) {
          if ((prior.afterJson as { hash: string }).hash !== hash)
            throw new AccountError(
              "This upload request was already used for another photo.",
              409,
            );
          return { id: prior.entityId };
        }
        const stored = await saveCatalogImage(bytes, tx);
        await tx.productImage.updateMany({
          where: { productId: id },
          data: { isPrimary: false },
        });
        const saved = await tx.productImage.create({
          data: {
            productId: id,
            storageKey: stored.storageKey,
            alt: product.name,
            isPrimary: true,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "catalog.image.saved",
            entityType: "ProductImage",
            entityId: saved.id,
            afterJson: { requestKey, hash },
          },
        });
        return { id: saved.id };
      },
      { timeout: 15000 },
    );
    return accountJson({ image }, 201);
  } catch (error) {
    return accountFailure(error);
  }
}
