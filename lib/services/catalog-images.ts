import sharp from "sharp";
import { AccountError } from "@/lib/domain/account";
import { putLocalObject } from "@/lib/storage";
export const catalogUploadReady = () =>
  process.env.APP_ENV === "development" &&
  process.env.DD_LOCAL_CATALOG_STORAGE === "true";
export async function saveCatalogImage(image: Buffer) {
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
  return putLocalObject({
    bytes: sanitized,
    namespace: "catalog",
    filename: "product.jpg",
    contentType: "image/jpeg",
  });
}
