import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { DEFAULT_HOME_SECTIONS, collectDraftCopy, findForbiddenDefaultCopy } from "@/lib/domain/site-content";
import {
  ensureDefaultSiteContent,
  getHomePageForBuilder,
  getPublishedHomePage,
  getServiceCounties,
  publishHomeSections,
} from "@/lib/services/site-content";

describe.sequential("website builder persistence", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("seeds defaults, publishes edits, hides unpublished copy, and writes an audit log", async () => {
    await ensureDefaultSiteContent();
    await publishHomeSections(DEFAULT_HOME_SECTIONS);
    const published = await getPublishedHomePage();
    expect(published.page.slug).toBe("home");
    expect(published.page.sections.length).toBeGreaterThan(0);
    expect(published.page.sections.every((section) => section.visible)).toBe(true);
    expect(published.counties.length).toBeGreaterThan(0);

    const defaultCopy = [
      ...published.page.sections.map((section) => collectDraftCopy(section)),
      published.counties.join(" "),
    ].join("\n");
    expect(findForbiddenDefaultCopy(defaultCopy)).toEqual([]);
    expect(defaultCopy.toLowerCase()).toContain("weekly");

    const builder = await getHomePageForBuilder();
    const title = `Weekly restock ${randomUUID().slice(0, 8)}`;
    const nextSections = builder.page.sections.map((section) =>
      section.sectionId === "hero"
        ? { ...section, title, visible: true }
        : section.sectionId === "porch-checker"
          ? { ...section, visible: false }
          : section,
    );

    const actorUserId = (
      await prisma.user.findFirst({ select: { id: true } })
    )?.id;

    const publishedResult = await publishHomeSections(nextSections, actorUserId);
    expect(publishedResult.page.sections.find((section) => section.sectionId === "hero")?.title).toBe(
      title,
    );
    expect(
      publishedResult.page.sections.find((section) => section.sectionId === "porch-checker")
        ?.visible,
    ).toBe(false);

    const storefront = await getPublishedHomePage();
    expect(storefront.page.sections.find((section) => section.sectionId === "hero")?.title).toBe(title);
    expect(storefront.page.sections.some((section) => section.sectionId === "porch-checker")).toBe(
      false,
    );

    const builderAfter = await getHomePageForBuilder();
    expect(builderAfter.page.sections.some((section) => section.sectionId === "porch-checker")).toBe(
      true,
    );

    const audit = await prisma.auditLog.findFirst({
      where: { action: "site.page.publish", entityId: publishedResult.page.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe("SitePage");
    expect(JSON.stringify(audit?.afterJson)).toContain(title);

    await publishHomeSections(DEFAULT_HOME_SECTIONS, actorUserId);
  });

  it("reads configurable Chicagoland counties from delivery settings", async () => {
    const counties = await getServiceCounties();
    expect(counties.length).toBeGreaterThan(0);
    const storefront = await getPublishedHomePage();
    expect(storefront.counties).toEqual(counties);
  });
});
