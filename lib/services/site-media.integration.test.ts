import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { readSiteImage, saveSiteImage, siteMediaStatus } from "./site-media";

async function photo() {
  const color = randomUUID().replaceAll("-", "").slice(0, 6);
  return sharp({
    create: { width: 87, height: 69, channels: 3, background: `#${color}` },
  })
    .png()
    .toBuffer();
}

describe.sequential("website photo recovery and capacity", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps a single durable photo and audit across simultaneous and lost-response retries", async () => {
    const user = await prisma.user.create({
      data: { email: `photo-${randomUUID()}@example.test` },
    });
    const bytes = await photo();
    const other = new PrismaClient({ log: [] });
    let imageId: string | undefined;
    try {
      const saved = await Promise.all(
        Array.from({ length: 4 }, () => saveSiteImage(bytes, user.id)),
      );
      imageId = saved[0].id;
      expect(saved.every((image) => image.id === imageId)).toBe(true);
      expect(await saveSiteImage(bytes, user.id)).toEqual(saved[0]);
      const independentlyRead = await other.siteMedia.findUniqueOrThrow({
        where: { id: imageId },
      });
      expect(Buffer.from(await readSiteImage(imageId))).toEqual(
        Buffer.from(independentlyRead.bytes),
      );
      expect(
        await prisma.auditLog.count({
          where: { entityId: imageId, action: "site.media.uploaded" },
        }),
      ).toBe(1);
      const metadata = await sharp(independentlyRead.bytes).metadata();
      expect(metadata).toMatchObject({ format: "webp", width: 87, height: 69 });
      expect(metadata.exif).toBeUndefined();
      const status = await siteMediaStatus();
      expect(status).toMatchObject({ kind: "WEBSITE", ready: true });
      expect(status.bytes).toBeGreaterThanOrEqual(independentlyRead.size);
      // Stored corruption fails closed; publication checks alone do not establish valid bytes.
      await prisma.siteMedia.update({
        where: { id: imageId },
        data: { bytes: Buffer.from("corrupt") },
      });
      await expect(readSiteImage(imageId)).rejects.toMatchObject({ status: 503 });
    } finally {
      if (imageId) {
        await prisma.auditLog.deleteMany({ where: { entityId: imageId } });
        await prisma.siteMedia.delete({ where: { id: imageId } });
      }
      await prisma.user.delete({ where: { id: user.id } });
      await other.$disconnect();
    }
  });

  it("rolls back a failed upload audit and preserves existing media at capacity", async () => {
    const bytes = await photo();
    const before = await siteMediaStatus();
    await expect(saveSiteImage(bytes, `missing-${randomUUID()}`)).rejects.toThrow();
    expect(await siteMediaStatus()).toEqual(before);
    const user = await prisma.user.create({
      data: { email: `quota-${randomUUID()}@example.test` },
    });
    const existing = await saveSiteImage(bytes, user.id);
    const filler = await prisma.siteMedia.create({
      data: {
        bytes: Buffer.alloc(1024 * 1024),
        sha256: `quota-${randomUUID()}`,
        mimeType: "image/webp",
        size: 1024 * 1024,
        width: 1,
        height: 1,
        uploadedByUserId: user.id,
      },
    });
    try {
      vi.stubEnv("DD_WEBSITE_MEDIA_LIMIT_MB", "1");
      const full = await siteMediaStatus();
      expect(full.capacityWarning).toBe(true);
      // A committed request remains retryable even when no room remains for a new photo.
      expect(await saveSiteImage(bytes, user.id)).toEqual(existing);
      await expect(saveSiteImage(await photo(), user.id)).rejects.toMatchObject({
        status: 409,
      });
      expect(await siteMediaStatus()).toEqual(full);
      expect((await readSiteImage(existing.id)).length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllEnvs();
      await prisma.auditLog.deleteMany({ where: { entityId: existing.id } });
      await prisma.siteMedia.deleteMany({
        where: { id: { in: [existing.id, filler.id] } },
      });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
