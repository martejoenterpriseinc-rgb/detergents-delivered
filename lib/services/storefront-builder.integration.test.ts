import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { DEFAULT_HOME_SECTIONS, DEFAULT_SITE_SETTINGS } from "@/lib/domain/site-content";
import {
  ensureDefaultSiteContent,
  getHomePageForBuilder,
  getPublishedHomePage,
  saveHomeDocument,
  publishedMediaExists,
  publishHomeSections,
  listPublishedHomeRevisions,
  readPublishedHomeRevision,
} from "./site-content";
import { saveSiteImage } from "./site-media";
import { getDeliveryCoverage, refreshCoverageLocations } from "./delivery-coverage";

describe.sequential("versioned website and durable media", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it("saves drafts, handles concurrent editors and retries, and atomically publishes photos", async () => {
    await Promise.all([ensureDefaultSiteContent(), ensureDefaultSiteContent()]);
    await publishHomeSections(DEFAULT_HOME_SECTIONS);
    const user = await prisma.user.create({
      data: { email: `builder-${randomUUID()}@example.test` },
    });
    const raw = await sharp({
      create: {
        width: 50,
        height: 40,
        channels: 3,
        background: { r: 15, g: 80, b: 120 },
      },
    })
      .png()
      .toBuffer();
    const image = await saveSiteImage(raw, user.id);
    expect(await saveSiteImage(raw, user.id)).toEqual(image);
    expect(
      (await prisma.siteMedia.findUniqueOrThrow({ where: { id: image.id } })).bytes
        .length,
    ).toBeGreaterThan(0);
    expect(await publishedMediaExists(image.id)).toBe(false);
    const initial = await getHomePageForBuilder();
    const document = {
      settings: { ...DEFAULT_SITE_SETTINGS, brandName: "Synthetic local store" },
      sections: DEFAULT_HOME_SECTIONS.map((s) => ({
        ...s,
        title: s.sectionId === "hero" ? "Saved synthetic draft" : s.title,
        ...(s.sectionId === "hero"
          ? {
              imageId: image.id,
              imageAlt: "Synthetic fixture",
              imagePositionX: 20,
              mobileImagePositionY: 80,
            }
          : {}),
      })),
    };
    const input = {
      document,
      version: initial.page.version,
      requestKey: randomUUID(),
      mode: "draft" as const,
    };
    const first = await saveHomeDocument(input, user.id);
    expect(await saveHomeDocument(input, user.id)).toEqual(first);
    expect((await getHomePageForBuilder()).draft?.sections[0].title).toBe(
      "Saved synthetic draft",
    );
    expect((await getPublishedHomePage()).page.sections[0].title).not.toBe(
      "Saved synthetic draft",
    );
    expect(await publishedMediaExists(image.id)).toBe(false);
    await expect(
      saveHomeDocument(
        {
          ...input,
          document: {
            ...document,
            settings: { ...document.settings, brandName: "Reused key" },
          },
        },
        user.id,
      ),
    ).rejects.toThrow(/key/);
    await expect(
      saveHomeDocument({ ...input, requestKey: randomUUID() }, user.id),
    ).rejects.toThrow(/Another editor/);
    const versions = await Promise.allSettled(
      [1, 2].map(() =>
        saveHomeDocument(
          { ...input, version: first.version, mode: "publish", requestKey: randomUUID() },
          user.id,
        ),
      ),
    );
    expect(versions.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(versions.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await publishedMediaExists(image.id)).toBe(true);
    expect((await getHomePageForBuilder()).draft).toBeNull();
    const published = (await getPublishedHomePage()).page;
    expect(published.settings.brandName).toBe("Synthetic local store");
    expect(published.sections[0].imageId).toBe(image.id);
    expect(published.sections[0]).toMatchObject({
      imagePositionX: 20,
      mobileImagePositionY: 80,
    });
    const history = await listPublishedHomeRevisions();
    expect(history.revisions[0].version).toBe(published.version);
    expect(history.revisions.some((revision) => revision.version === first.version)).toBe(
      false,
    );
    const recovered = await readPublishedHomeRevision(published.version);
    expect(recovered.document.sections[0].imageId).toBe(image.id);
    expect(
      (await listPublishedHomeRevisions(published.version)).revisions.every(
        (r) => r.version < published.version,
      ),
    ).toBe(true);
    await expect(readPublishedHomeRevision(first.version)).rejects.toMatchObject({
      status: 404,
    });
    const badDocument = {
      ...document,
      sections: document.sections.map((s) =>
        s.sectionId === "hero" ? { ...s, imageId: "missing-media" } : s,
      ),
    };
    await expect(
      saveHomeDocument(
        {
          document: badDocument,
          version: published.version,
          mode: "publish",
          requestKey: randomUUID(),
        },
        user.id,
      ),
    ).rejects.toThrow(/photo/);
    expect((await getHomePageForBuilder()).page.version).toBe(published.version);
    await saveHomeDocument(
      {
        document: { sections: DEFAULT_HOME_SECTIONS, settings: DEFAULT_SITE_SETTINGS },
        version: published.version,
        mode: "publish",
        requestKey: randomUUID(),
      },
      user.id,
    );
    expect(await publishedMediaExists(image.id)).toBe(false);
    const current = await getHomePageForBuilder();
    await saveHomeDocument(
      {
        document: recovered.document,
        version: current.page.version,
        mode: "draft",
        requestKey: randomUUID(),
      },
      user.id,
    );
    expect(await publishedMediaExists(image.id)).toBe(false);
    expect((await getHomePageForBuilder()).draft?.sections[0].imageId).toBe(image.id);
    await publishHomeSections(DEFAULT_HOME_SECTIONS);
    await expect(
      saveSiteImage(Buffer.from("<svg><script>alert(1)</script></svg>"), user.id),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      saveSiteImage(Buffer.alloc(4 * 1024 * 1024 + 1), user.id),
    ).rejects.toMatchObject({ status: 413 });
    await prisma.siteMedia.delete({ where: { id: image.id } });
  });
  it("updates map membership from active ZIP settings, caches verified centers and keeps a list during lookup failures", async () => {
    const zone = await prisma.deliveryZone.create({
      data: {
        name: `Map fixture ${randomUUID()}`,
        slug: `map-fixture-${randomUUID()}`,
        isActive: true,
        boundaryJson: { postalCodes: ["99980", "99981"] },
      },
    });
    const fetcher: typeof fetch = async (url) => {
      const zip = String(url).split("/").at(-1)!;
      if (zip !== "99980") return new Response(null, { status: 503 });
      return Response.json({
        "post code": zip,
        "country abbreviation": "US",
        places: [
          { latitude: "42.0", longitude: "-88.0", "place name": "Synthetic center" },
        ],
      });
    };
    try {
      await prisma.postalLocation.createMany({
        data: ["99980", "99981"].map((postalCode) => ({
          postalCode,
          retryAt: new Date(-1000),
        })),
        skipDuplicates: true,
      });
      await refreshCoverageLocations(fetcher);
      const before = await getDeliveryCoverage();
      expect(before.postalCodes).toContain("99980");
      expect(before.postalCodes).toContain("99981");
      expect(before.points.find((p) => p.postalCode === "99980")?.placeName).toBe(
        "Synthetic center",
      );
      expect(before.points.some((p) => p.postalCode === "99981")).toBe(false);
      await prisma.deliveryZone.update({
        where: { id: zone.id },
        data: { boundaryJson: { postalCodes: ["99981"] } },
      });
      expect(
        (await getDeliveryCoverage()).points.some((p) => p.postalCode === "99980"),
      ).toBe(false);
      await prisma.deliveryZone.update({
        where: { id: zone.id },
        data: { isActive: false },
      });
      expect((await getDeliveryCoverage()).postalCodes).not.toContain("99981");
    } finally {
      await prisma.deliveryZone.delete({ where: { id: zone.id } });
      await prisma.postalLocation.deleteMany({
        where: { postalCode: { in: ["99980", "99981"] } },
      });
    }
  });
});
