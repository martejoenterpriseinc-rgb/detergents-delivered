import sharp from "sharp";
import type { Prisma } from "@prisma/client";
import { AccountError } from "@/lib/domain/account";
import { putLocalObject, readLocalObject } from "@/lib/storage";
import {
  operationalMediaReady,
  putOperationalMedia,
  readOperationalMedia,
} from "@/lib/operations/media";
const localCatalog = () =>
  process.env.APP_ENV === "development" &&
  process.env.DD_LOCAL_CATALOG_STORAGE === "true";
export const catalogUploadReady = () =>
  localCatalog() || operationalMediaReady("CATALOG");
export async function saveCatalogImage(image: Buffer, tx?: Prisma.TransactionClient) {
  if (!catalogUploadReady())
    throw new AccountError(
      "Durable catalog image storage is not connected. No image has been saved.",
      503,
    );
  if (image.length > 4 * 1024 * 1024)
    throw new AccountError("Choose an image under 4 MB.", 413);
  let sanitized: Buffer;
  try {
    const decoder = sharp(image, { limitInputPixels: 24000000, failOn: "warning" });
    const meta = await decoder.metadata();
    if (!["jpeg", "png"].includes(meta.format ?? "")) throw new Error("format");
    sanitized = await decoder
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    throw new AccountError("Choose a valid JPEG or PNG image.", 415);
  }
  if (!localCatalog()) {
    if (!tx) throw new AccountError("An atomic product save is required.", 503);
    return putOperationalMedia(tx, sanitized, "CATALOG");
  }
  return putLocalObject({
    bytes: sanitized,
    namespace: "catalog",
    filename: "product.jpg",
    contentType: "image/jpeg",
  });
}
export async function loadCatalogImage(key: string) {
  if (key.startsWith("db/catalog/")) return readOperationalMedia(key, "CATALOG");
  if (localCatalog() && key.startsWith("local/catalog/")) return readLocalObject(key);
  throw new AccountError("Photo not found.", 404);
}
