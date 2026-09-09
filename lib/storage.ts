import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const LOCAL_STORAGE_PREFIX = "local/";
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export function isLocalStorageKey(storageKey: string) {
  return storageKey.startsWith(LOCAL_STORAGE_PREFIX);
}

export function assertSafeStorageKey(storageKey: string) {
  if (!storageKey || storageKey.includes("..") || storageKey.startsWith("/")) {
    throw new Error("invalid storage key");
  }
  return storageKey;
}

/**
 * Dev/local stub: write bytes under ./uploads and return an object-storage key.
 * Private assets are never placed in public/ and never returned as unsigned URLs.
 */
export async function putLocalObject(input: {
  bytes: Buffer;
  filename: string;
  contentType?: string;
  namespace?: "catalog";
}): Promise<{
  storageKey: string;
  byteSize: number;
  contentType?: string;
  filename: string;
}> {
  const safeName =
    input.filename.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "file";
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const storageKey = `${LOCAL_STORAGE_PREFIX}${input.namespace ? input.namespace + "/" : ""}${year}/${month}/${randomUUID()}-${safeName}`;
  const destFromKey = path.join(
    UPLOADS_DIR,
    storageKey.slice(LOCAL_STORAGE_PREFIX.length),
  );
  await mkdir(path.dirname(destFromKey), { recursive: true });
  await writeFile(destFromKey, input.bytes);
  return {
    storageKey,
    byteSize: input.bytes.length,
    contentType: input.contentType,
    filename: safeName,
  };
}

export async function readLocalObject(storageKey: string): Promise<Buffer> {
  const key = assertSafeStorageKey(storageKey);
  if (!isLocalStorageKey(key)) {
    throw new Error("object is not stored on the local stub");
  }
  const relative = key.slice(LOCAL_STORAGE_PREFIX.length);
  return readFile(path.join(UPLOADS_DIR, relative));
}

export function publicUnsignedUrlForbidden(): never {
  throw new Error("private assets must not be exposed as public unsigned URLs");
}
