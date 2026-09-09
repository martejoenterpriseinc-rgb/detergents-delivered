import sharp from "sharp";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
export async function saveSiteImage(bytes: Buffer, userId: string) {
  if (!bytes.length || bytes.length > 4 * 1024 * 1024)
    throw new AccountError("Choose a photo under 4 MB.", 413);
  let image: { data: Buffer; info: { width: number; height: number } };
  try {
    const decoder = sharp(bytes, { limitInputPixels: 24_000_000, failOn: "warning" });
    const meta = await decoder.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1)
      throw new Error("format");
    image = await decoder
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AccountError(
      "Choose a valid JPEG, PNG or WebP photo, up to 24 megapixels.",
      415,
    );
  }
  if (image.data.length > 4 * 1024 * 1024)
    throw new AccountError(
      "This photo is too large after processing. Choose a smaller photo.",
      413,
    );
  const sha256 = createHash("sha256").update(image.data).digest("hex");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(613279110)`;
    const existing = await tx.siteMedia.findUnique({
      where: { sha256 },
      select: { id: true, width: true, height: true },
    });
    if (existing) return existing;
    const total = await tx.siteMedia.aggregate({ _sum: { size: true } });
    if ((total._sum.size ?? 0) + image.data.length > 100 * 1024 * 1024)
      throw new AccountError(
        "The website photo storage limit has been reached. Contact your administrator to increase storage.",
        409,
      );
    const saved = await tx.siteMedia.create({
      data: {
        bytes: new Uint8Array(image.data),
        mimeType: "image/webp",
        size: image.data.length,
        width: image.info.width,
        height: image.info.height,
        sha256,
        uploadedByUserId: userId,
      },
      select: { id: true, width: true, height: true },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "site.media.uploaded",
        entityType: "SiteMedia",
        entityId: saved.id,
        afterJson: { ...saved, size: image.data.length },
      },
    });
    return saved;
  });
}
