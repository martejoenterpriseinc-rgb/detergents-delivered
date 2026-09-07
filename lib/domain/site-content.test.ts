import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHICAGOLAND_COUNTIES,
  DEFAULT_HOME_SECTIONS,
  SiteContentError,
  WEBSITE_MANAGER_ROLES,
  canManageWebsite,
  collectDraftCopy,
  findForbiddenDefaultCopy,
  normalizeCountyList,
  parseCountyList,
  requireWebsiteManager,
  validateSiteSectionDraft,
  validateSiteSectionDrafts,
} from "./site-content";

describe("website builder authorization", () => {
  it("allows ADMIN and SUPER_ADMIN only", () => {
    expect(canManageWebsite(["ADMIN"])).toBe(true);
    expect(canManageWebsite(["SUPER_ADMIN"])).toBe(true);
    expect(canManageWebsite(["INVENTORY"])).toBe(false);
    expect(canManageWebsite(["CPA"])).toBe(false);
    expect(canManageWebsite(["CUSTOMER"])).toBe(false);
    expect(canManageWebsite(["DRIVER"])).toBe(false);
    expect(WEBSITE_MANAGER_ROLES).toEqual(["ADMIN", "SUPER_ADMIN"]);
    expect(() => requireWebsiteManager(["INVENTORY"])).toThrow(SiteContentError);
    expect(() => requireWebsiteManager(["ADMIN"])).not.toThrow();
  });
});

describe("default home copy", () => {
  it("uses weekly scheduled delivery, Chicagoland counties, and no name-brand marketing", () => {
    const blob = DEFAULT_HOME_SECTIONS.map((section) => collectDraftCopy(section)).join("\n");
    expect(blob.toLowerCase()).toContain("weekly");
    expect(blob.toLowerCase()).toContain("chicagoland");
    expect(findForbiddenDefaultCopy(blob)).toEqual([]);
    expect(DEFAULT_CHICAGOLAND_COUNTIES).toContain("Cook");
    expect(DEFAULT_CHICAGOLAND_COUNTIES).toContain("DuPage");
    expect(DEFAULT_HOME_SECTIONS.some((section) => section.sectionId === "hero")).toBe(true);
  });
});

describe("section validation", () => {
  it("accepts a well-formed section and rejects unsafe hrefs or unknown types", () => {
    const draft = validateSiteSectionDraft({
      sectionId: "hero",
      type: "hero",
      title: "Hello",
      ctaHref: "/shop",
      secondaryCtaHref: "https://example.com",
      visible: true,
      sortOrder: 0,
    });
    expect(draft.ctaHref).toBe("/shop");
    expect(() =>
      validateSiteSectionDraft({ sectionId: "hero", type: "hero", ctaHref: "javascript:alert(1)" }),
    ).toThrow(/ctaHref/);
    expect(() => validateSiteSectionDraft({ sectionId: "hero", type: "popup" })).toThrow(
      /unknown type/,
    );
  });

  it("requires unique section ids and at least one section on publish", () => {
    expect(() => validateSiteSectionDrafts([])).toThrow(/at least one/);
    expect(() =>
      validateSiteSectionDrafts([
        { sectionId: "hero", type: "hero" },
        { sectionId: "hero", type: "cta" },
      ]),
    ).toThrow(/duplicate/);
    const drafts = validateSiteSectionDrafts([
      { sectionId: "b", type: "cta", sortOrder: 2 },
      { sectionId: "a", type: "hero", sortOrder: 0 },
    ]);
    expect(drafts.map((section) => section.sectionId)).toEqual(["a", "b"]);
    expect(drafts.map((section) => section.sortOrder)).toEqual([0, 1]);
  });
});

describe("county list", () => {
  it("trims, dedupes, and parses comma or newline lists", () => {
    expect(normalizeCountyList([" Cook ", "cook", "Will", ""])).toEqual(["Cook", "Will"]);
    expect(parseCountyList("Cook, DuPage\nKane")).toEqual(["Cook", "DuPage", "Kane"]);
  });
});
