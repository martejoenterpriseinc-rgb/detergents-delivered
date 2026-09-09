import "@/tests/integration-guard";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { operationsFixture } from "@/tests/operations-fixture";
import { addShopEntry } from "@/lib/services/shop-entry";
import {
  completeWithPhoto,
  deliveryAction,
  ownedProof,
} from "@/lib/services/delivery-operations";
import { GET as publicImage } from "@/app/api/catalog/media/[id]/route";
import { operationalMediaStatus, readOperationalMedia } from "./media";

const image = () =>
  sharp({ create: { width: 80, height: 60, channels: 3, background: "#146b52" } })
    .withExif({ IFD0: { Artist: "Synthetic-private-metadata" } })
    .jpeg()
    .toBuffer();
afterEach(() => vi.unstubAllEnvs());
function databaseStorage() {
  vi.stubEnv("DD_LOCAL_CATALOG_STORAGE", "false");
  vi.stubEnv("DD_LOCAL_PROOF_STORAGE", "false");
  vi.stubEnv("DD_OPERATING_MEDIA_ENABLED", "true");
  vi.stubEnv("DD_BUSINESS_DOCUMENT_ACTIVE_KEY", "media_test");
  vi.stubEnv(
    "DD_BUSINESS_DOCUMENT_KEYS",
    JSON.stringify({ media_test: "37".repeat(32) }),
  );
}
it("commits durable catalog pixels with the product, retries once and hides unpublished images", async () => {
  databaseStorage();
  const f = await operationsFixture(prisma);
  let productId: string | undefined;
  let mediaKey: string | undefined;
  try {
    const data = {
      title: "Synthetic media product",
      description: "Storage acceptance",
      sku: `MEDIA-${randomUUID()}`,
      priceCents: 3500,
      retailCents: 4000,
      loadKind: "DETERGENT",
      deliveryCapacityUnits: 1,
      publish: false,
      requestKey: randomUUID(),
    };
    const bytes = await image();
    const saved = await addShopEntry(f.admin.id, data, bytes);
    productId = saved.id;
    expect(await addShopEntry(f.admin.id, data, bytes)).toEqual(saved);
    const photo = await prisma.productImage.findFirstOrThrow({ where: { productId } });
    mediaKey = photo.storageKey;
    expect(await prisma.productImage.count({ where: { productId } })).toBe(1);
    expect(photo.storageKey).toMatch(/^db\/catalog\/sandbox\//);
    const raw = await prisma.operationalMedia.findUniqueOrThrow({
      where: { key: mediaKey },
    });
    expect(raw.keyId).toBeNull();
    expect((await sharp(raw.bytes).metadata()).exif).toBeUndefined();
    const request = new Request(`https://example.test/api/catalog/media/${photo.id}`);
    expect(
      (await publicImage(request, { params: Promise.resolve({ id: photo.id }) })).status,
    ).toBe(404);
    await prisma.product.update({
      where: { id: productId },
      data: { websiteVisible: true },
    });
    const published = await publicImage(request, {
      params: Promise.resolve({ id: photo.id }),
    });
    expect(published.status).toBe(200);
    expect(published.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await published.arrayBuffer())).toEqual(Buffer.from(raw.bytes));
    await expect(readOperationalMedia(mediaKey, "PROOF")).rejects.toMatchObject({
      status: 404,
    });
    vi.stubEnv("APP_ENV", "production");
    await expect(readOperationalMedia(mediaKey, "CATALOG")).rejects.toMatchObject({
      status: 404,
    });
    vi.stubEnv("APP_ENV", "development");
    const { PrismaClient } = await import("@prisma/client");
    const second = new PrismaClient({ log: [] });
    try {
      expect(
        (await second.operationalMedia.findUniqueOrThrow({ where: { key: mediaKey } }))
          .bytes,
      ).toEqual(raw.bytes);
    } finally {
      await second.$disconnect();
    }
  } finally {
    if (productId) {
      await prisma.auditLog.deleteMany({ where: { entityId: productId } });
      await prisma.productImage.deleteMany({ where: { productId } });
      await prisma.productPrice.deleteMany({ where: { productVariant: { productId } } });
      await prisma.productVariant.deleteMany({ where: { productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    if (mediaKey) await prisma.operationalMedia.delete({ where: { key: mediaKey } });
    await f.cleanup();
  }
});
it("keeps private proof pixels encrypted, preserves access scope and rejects substituted catalog references", async () => {
  databaseStorage();
  const f = await operationsFixture(prisma);
  let key: string | undefined, forgedId: string | undefined;
  try {
    const first = f.route.stops[0];
    for (const action of ["begin", "navigate", "arrive"] as const)
      await deliveryAction(f.driver.id, {
        action,
        routeId: f.route.id,
        stopId: action === "begin" ? undefined : first.id,
        requestKey: randomUUID(),
      });
    const requestKey = randomUUID(),
      bytes = await image();
    await Promise.all([
      completeWithPhoto(f.driver.id, f.route.id, first.id, requestKey, bytes),
      completeWithPhoto(f.driver.id, f.route.id, first.id, requestKey, bytes),
    ]);
    const photo = await prisma.deliveryPhoto.findFirstOrThrow({
      where: { deliveryAttempt: { routeStopId: first.id } },
    });
    key = photo.storageKey;
    const media = await prisma.operationalMedia.findUniqueOrThrow({ where: { key } });
    expect(media.kind).toBe("PROOF");
    expect(media.keyId).toBe("media_test");
    const revealed = await ownedProof(f.customers[0].id, photo.id);
    expect(Buffer.from(media.bytes).equals(revealed)).toBe(false);
    expect((await sharp(revealed).metadata()).exif).toBeUndefined();
    await expect(ownedProof(f.customers[1].id, photo.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(ownedProof(f.stranger.id, photo.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await ownedProof(f.admin.id, photo.id)).toEqual(revealed);
    await prisma.product.update({
      where: { id: f.product.id },
      data: { websiteVisible: true },
    });
    const forged = await prisma.productImage.create({
      data: { productId: f.product.id, storageKey: key },
    });
    forgedId = forged.id;
    expect(
      (
        await publicImage(new Request("https://example.test"), {
          params: Promise.resolve({ id: forged.id }),
        })
      ).status,
    ).toBe(404);
    const tampered = Buffer.from(media.bytes);
    tampered[40] ^= 1;
    await prisma.operationalMedia.update({ where: { key }, data: { bytes: tampered } });
    await expect(ownedProof(f.admin.id, photo.id)).rejects.toMatchObject({ status: 503 });
    await prisma.operationalMedia.update({
      where: { key },
      data: { bytes: media.bytes },
    });
    vi.stubEnv("DD_BUSINESS_DOCUMENT_ACTIVE_KEY", "rotated");
    vi.stubEnv(
      "DD_BUSINESS_DOCUMENT_KEYS",
      JSON.stringify({ media_test: "37".repeat(32), rotated: "38".repeat(32) }),
    );
    expect(await ownedProof(f.admin.id, photo.id)).toEqual(revealed);
  } finally {
    if (forgedId) await prisma.productImage.delete({ where: { id: forgedId } });
    if (key) {
      await prisma.deliveryPhoto.deleteMany({ where: { storageKey: key } });
      await prisma.operationalMedia.delete({ where: { key } });
    }
    await f.cleanup();
  }
});
it("rolls back new media when an audit fails and refuses a full storage budget without adding a product", async () => {
  databaseStorage();
  const f = await operationsFixture(prisma);
  try {
    const before = await operationalMediaStatus();
    const data = {
      title: "Synthetic rollback",
      description: "Storage acceptance",
      sku: `MEDIA-${randomUUID()}`,
      priceCents: 3500,
      retailCents: 4000,
      loadKind: "DETERGENT",
      deliveryCapacityUnits: 1,
      publish: false,
      requestKey: randomUUID(),
    };
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION dd_media_audit_fail() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.action = ''shop.entry.created'' THEN RAISE EXCEPTION ''synthetic media audit failure''; END IF; RETURN NEW; END'`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER dd_media_audit_test BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION dd_media_audit_fail()`,
    );
    try {
      await expect(addShopEntry(f.admin.id, data, await image())).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER dd_media_audit_test ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION dd_media_audit_fail()`);
    }
    expect(await operationalMediaStatus()).toEqual(before);
    expect(
      await prisma.productVariant.findUnique({ where: { sku: data.sku } }),
    ).toBeNull();
    vi.stubEnv("DD_CATALOG_MEDIA_LIMIT_MB", "1");
    const large = await sharp(randomBytes(1600 * 1600 * 3), {
      raw: { width: 1600, height: 1600, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    await expect(addShopEntry(f.admin.id, data, large)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await prisma.productVariant.findUnique({ where: { sku: data.sku } }),
    ).toBeNull();
  } finally {
    await f.cleanup();
  }
});
