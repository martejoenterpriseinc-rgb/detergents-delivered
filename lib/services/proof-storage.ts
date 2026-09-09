import sharp from "sharp";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { putLocalObject, readLocalObject } from "@/lib/storage";
import { AccountError } from "@/lib/domain/account";
import {
  operationalMediaReady,
  putOperationalMedia,
  readOperationalMedia,
} from "@/lib/operations/media";
// This existing local adapter is only permitted in isolated development. Render's
// ephemeral disk must never be presented as durable proof-photo storage.
function localProof() {
  return (
    process.env.APP_ENV === "development" && process.env.DD_LOCAL_PROOF_STORAGE === "true"
  );
}
export function proofStorageReady() {
  return localProof() || operationalMediaReady("PROOF");
}
export async function saveProof(bytes: Buffer, tx?: Prisma.TransactionClient) {
  if (!proofStorageReady())
    throw new AccountError(
      "Private delivery-photo storage must be connected before starting deliveries.",
      503,
    );
  if (bytes.length < 16 || bytes.length > 4 * 1024 * 1024)
    throw new AccountError("Use a photo smaller than 4 MB.", 413);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!jpeg && !png) throw new AccountError("Use a JPEG or PNG photo.", 415);
  let sanitized: Buffer;
  try {
    sanitized = await sharp(bytes, { limitInputPixels: 24000000, failOn: "warning" })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    throw new AccountError(
      "This photo could not be decoded. Choose a valid JPEG or PNG.",
      415,
    );
  }
  if (!localProof()) {
    if (!tx) throw new AccountError("An atomic delivery save is required.", 503);
    return putOperationalMedia(tx, sanitized, "PROOF");
  }
  const result = await putLocalObject({
    bytes: sanitized,
    filename: "delivery.jpg",
    contentType: "image/jpeg",
  });
  return { ...result, hash: createHash("sha256").update(sanitized).digest("hex") };
}
export async function loadProof(key: string) {
  if (key.startsWith("db/proof/")) return readOperationalMedia(key, "PROOF");
  if (localProof() && key.startsWith("local/") && !key.startsWith("local/catalog/"))
    return readLocalObject(key);
  throw new AccountError("Photo storage is unavailable.", 503);
}
