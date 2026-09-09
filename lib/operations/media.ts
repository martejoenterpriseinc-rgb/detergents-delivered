import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { integrationEnvironment } from "@/lib/integration-environment";
import {
  decryptDocument,
  documentReadiness,
  encryptDocument,
} from "@/lib/business/document-security";

type Kind = "CATALOG" | "PROOF";
export function operationalMediaReady(kind: Kind) {
  return (
    Boolean(integrationEnvironment()) &&
    process.env.DD_OPERATING_MEDIA_ENABLED !== "false" &&
    (kind === "CATALOG" || documentReadiness().encryption)
  );
}
export function mediaLimit(kind: Kind) {
  const value =
    process.env[
      kind === "CATALOG" ? "DD_CATALOG_MEDIA_LIMIT_MB" : "DD_PROOF_MEDIA_LIMIT_MB"
    ];
  const limit = value === undefined ? (kind === "CATALOG" ? 250 : 500) : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 4096)
    throw new AccountError("Photo storage capacity is not configured correctly.", 503);
  return limit * 1024 * 1024;
}
export async function putOperationalMedia(
  tx: Prisma.TransactionClient,
  bytes: Buffer,
  kind: Kind,
) {
  const environment = integrationEnvironment();
  if (!environment || !operationalMediaReady(kind))
    throw new AccountError(
      "Photo storage is unavailable. Your changes have not been saved.",
      503,
    );
  if (!bytes.length || bytes.length > 4 * 1024 * 1024)
    throw new AccountError("Choose a photo under 4 MB after processing.", 413);
  const lock = `operational-media:${environment}:${kind}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
  const used = await tx.operationalMedia.aggregate({
    where: { environment, kind },
    _sum: { byteSize: true },
  });
  if ((used._sum.byteSize ?? 0) + bytes.length > mediaLimit(kind))
    throw new AccountError(
      "Photo storage is full. Ask your administrator to increase capacity; the current record is unchanged.",
      409,
    );
  const key = `db/${kind.toLowerCase()}/${environment}/${randomUUID()}.jpg`;
  const hash = createHash("sha256").update(bytes).digest("hex");
  // A distinct authenticated context prevents a proof from being read as a business document.
  const encrypted =
    kind === "PROOF"
      ? encryptDocument(bytes, `operational-proof:${environment}:${key}`)
      : null;
  await tx.operationalMedia.create({
    data: {
      key,
      kind,
      environment,
      bytes: new Uint8Array(encrypted?.ciphertext ?? bytes),
      keyId: encrypted?.keyId ?? null,
      sha256: hash,
      byteSize: bytes.length,
    },
  });
  return {
    storageKey: key,
    byteSize: bytes.length,
    contentType: "image/jpeg",
    filename: kind === "CATALOG" ? "product.jpg" : "delivery.jpg",
    hash,
  };
}
export async function readOperationalMedia(key: string, kind: Kind) {
  const environment = integrationEnvironment();
  const pattern = /^db\/(catalog|proof)\/(sandbox|live)\/[a-f0-9-]{36}\.jpg$/;
  if (
    !environment ||
    !pattern.test(key) ||
    !key.startsWith(`db/${kind.toLowerCase()}/${environment}/`)
  )
    throw new AccountError("Photo not found.", 404);
  const media = await prisma.operationalMedia.findFirst({
    where: { key, kind, environment },
  });
  if (!media) throw new AccountError("Photo not found.", 404);
  const bytes =
    kind === "PROOF"
      ? decryptDocument(
          media.bytes,
          `operational-proof:${environment}:${key}`,
          media.keyId!,
        )
      : Buffer.from(media.bytes);
  if (
    bytes.length !== media.byteSize ||
    createHash("sha256").update(bytes).digest("hex") !== media.sha256
  )
    throw new AccountError("Photo integrity could not be verified.", 503);
  return bytes;
}
export async function operationalMediaStatus() {
  const environment = integrationEnvironment();
  return Promise.all(
    (["CATALOG", "PROOF"] as const).map(async (kind) => {
      const used = environment
        ? await prisma.operationalMedia.aggregate({
            where: { environment, kind },
            _sum: { byteSize: true },
            _count: true,
          })
        : null;
      const bytes = used?._sum.byteSize ?? 0;
      const limit = mediaLimit(kind);
      return {
        kind,
        ready: operationalMediaReady(kind),
        bytes,
        limit,
        count: used?._count ?? 0,
        capacityWarning: bytes >= limit * 0.8,
      };
    }),
  );
}
