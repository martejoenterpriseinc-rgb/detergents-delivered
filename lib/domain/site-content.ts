import { hasRole, type RoleCode } from "./authz";

export const WEBSITE_MANAGER_ROLES: RoleCode[] = ["ADMIN", "SUPER_ADMIN"];

export const HOME_PAGE_SLUG = "home";

export const SERVICE_COUNTIES_SETTING_KEY = "delivery.serviceCounties";

export const SITE_SECTION_TYPES = [
  "hero",
  "highlight",
  "features",
  "service-area",
  "cta",
] as const;

export type SiteSectionType = (typeof SITE_SECTION_TYPES)[number];

export const SITE_STYLE_VARIANTS = ["default", "emphasis", "muted"] as const;

export type SiteStyleVariant = (typeof SITE_STYLE_VARIANTS)[number];

export const DEFAULT_CHICAGOLAND_COUNTIES = [
  "Cook",
  "DuPage",
  "Kane",
  "Kendall",
  "Lake",
  "McHenry",
  "Will",
] as const;

export type SiteSectionDraft = {
  sectionId: string;
  type: SiteSectionType;
  title: string;
  body: string;
  badgeText: string;
  ctaLabel: string;
  ctaHref: string;
  secondaryCtaLabel: string;
  secondaryCtaHref: string;
  visible: boolean;
  sortOrder: number;
  styleVariant: SiteStyleVariant;
  intentNotes: string;
};

const SAME_DAY_PATTERN =
  /\b(same[\s-]?day|next[\s-]?day|same[\s-]?night|overnight|24[\s-]?hour(?:s)?\s+deliver(?:y|ed)|deliver(?:y|ed)\s+today)\b/i;

const NAME_BRAND_PATTERN =
  /\b(tide(?:\s+pods)?|gain(?:\s+flings)?|downy|cheer|dreft|bounce|persil|arm\s*&\s*hammer|seventh\s+generation|mrs\.?\s*meyer'?s?|method|dawn|cascade|clorox|lysol|febreze|snuggle|purex|woolite|oxiclean|all-free)\b/i;

export class SiteContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteContentError";
  }
}

export function canManageWebsite(roles: readonly string[]): boolean {
  return hasRole(roles, WEBSITE_MANAGER_ROLES);
}

export function requireWebsiteManager(roles: readonly string[]): void {
  if (!canManageWebsite(roles)) {
    throw new SiteContentError("website builder requires ADMIN or SUPER_ADMIN");
  }
}

export function isSiteSectionType(value: string): value is SiteSectionType {
  return (SITE_SECTION_TYPES as readonly string[]).includes(value);
}

export function isSiteStyleVariant(value: string): value is SiteStyleVariant {
  return (SITE_STYLE_VARIANTS as readonly string[]).includes(value);
}

export function normalizeCountyList(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const counties: string[] = [];
  for (const raw of input) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    counties.push(name);
  }
  return counties;
}

export function parseCountyList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeCountyList(value.map((item) => String(item)));
  }
  if (typeof value === "string") {
    return normalizeCountyList(value.split(/[\n,]+/));
  }
  return [];
}

export function findForbiddenDefaultCopy(text: string): string[] {
  const hits: string[] = [];
  const sameDay = text.match(SAME_DAY_PATTERN);
  if (sameDay?.[0]) hits.push(sameDay[0]);
  const brand = text.match(NAME_BRAND_PATTERN);
  if (brand?.[0]) hits.push(brand[0]);
  return hits;
}

export function collectDraftCopy(draft: Pick<SiteSectionDraft, "title" | "body" | "badgeText" | "ctaLabel" | "secondaryCtaLabel" | "intentNotes">) {
  return [draft.title, draft.body, draft.badgeText, draft.ctaLabel, draft.secondaryCtaLabel, draft.intentNotes]
    .filter(Boolean)
    .join("\n");
}

function asOptionalString(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "on" || value === "1") return true;
  if (value === "false" || value === "off" || value === "0") return false;
  return fallback;
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return fallback;
}

export function assertSafeHref(href: string, field: string): void {
  const trimmed = href.trim();
  if (!trimmed) return;
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//")) {
      throw new SiteContentError(`${field} must be a site path or http(s) URL`);
    }
    return;
  }
  if (/^https?:\/\//i.test(trimmed)) return;
  throw new SiteContentError(`${field} must be a site path or http(s) URL`);
}

export function validateSiteSectionDraft(input: unknown, index = 0): SiteSectionDraft {
  if (!input || typeof input !== "object") {
    throw new SiteContentError(`section ${index} is invalid`);
  }
  const raw = input as Record<string, unknown>;
  const sectionId = asOptionalString(raw.sectionId).trim();
  if (!sectionId || sectionId.length > 80) {
    throw new SiteContentError(`section ${index} needs a sectionId`);
  }
  const typeRaw = asOptionalString(raw.type).trim();
  if (!isSiteSectionType(typeRaw)) {
    throw new SiteContentError(`section ${sectionId} has an unknown type`);
  }
  const styleRaw = asOptionalString(raw.styleVariant).trim() || "default";
  if (!isSiteStyleVariant(styleRaw)) {
    throw new SiteContentError(`section ${sectionId} has an unknown styleVariant`);
  }
  const draft: SiteSectionDraft = {
    sectionId,
    type: typeRaw,
    title: asOptionalString(raw.title).slice(0, 200),
    body: asOptionalString(raw.body).slice(0, 8000),
    badgeText: asOptionalString(raw.badgeText).slice(0, 120),
    ctaLabel: asOptionalString(raw.ctaLabel).slice(0, 80),
    ctaHref: asOptionalString(raw.ctaHref).trim().slice(0, 300),
    secondaryCtaLabel: asOptionalString(raw.secondaryCtaLabel).slice(0, 80),
    secondaryCtaHref: asOptionalString(raw.secondaryCtaHref).trim().slice(0, 300),
    visible: asBoolean(raw.visible, true),
    sortOrder: asInt(raw.sortOrder, index),
    styleVariant: styleRaw,
    intentNotes: asOptionalString(raw.intentNotes).slice(0, 2000),
  };
  assertSafeHref(draft.ctaHref, `${draft.sectionId}.ctaHref`);
  assertSafeHref(draft.secondaryCtaHref, `${draft.sectionId}.secondaryCtaHref`);
  return draft;
}

export function validateSiteSectionDrafts(input: unknown): SiteSectionDraft[] {
  if (!Array.isArray(input)) {
    throw new SiteContentError("sections must be an array");
  }
  if (input.length === 0) {
    throw new SiteContentError("publish at least one section");
  }
  if (input.length > 40) {
    throw new SiteContentError("too many sections");
  }
  const drafts = input.map((item, index) => validateSiteSectionDraft(item, index));
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.sectionId)) {
      throw new SiteContentError(`duplicate sectionId: ${draft.sectionId}`);
    }
    seen.add(draft.sectionId);
  }
  return drafts
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((draft, index) => ({ ...draft, sortOrder: index }));
}

export const DEFAULT_HOME_SECTIONS: SiteSectionDraft[] = [
  {
    sectionId: "hero",
    type: "hero",
    badgeText: "Weekly scheduled delivery",
    title: "Detergent and everyday clean — delivered to your door.",
    body: "Detergents Delivered is a neighborhood store for liquids, powders, pods, dish, paper, and cleaning consumables. Skip the bulk-aisle haul. We pack the heavy stuff and drop it on your porch on a weekly schedule across Chicagoland.",
    ctaLabel: "Shop household staples",
    ctaHref: "/shop",
    secondaryCtaLabel: "Check delivery area",
    secondaryCtaHref: "/delivery-area",
    visible: true,
    sortOrder: 0,
    styleVariant: "default",
    intentNotes:
      "Primary landing pitch. Send shoppers to the catalog or ZIP checker. Keep weekly scheduled delivery; do not promise rush windows.",
  },
  {
    sectionId: "porch-checker",
    type: "highlight",
    badgeText: "",
    title: "Do we reach your porch?",
    body: "Currently serving select towns in Chicagoland. Check your ZIP for the next weekly window.",
    ctaLabel: "",
    ctaHref: "",
    secondaryCtaLabel: "",
    secondaryCtaHref: "",
    visible: true,
    sortOrder: 1,
    styleVariant: "emphasis",
    intentNotes:
      "Companion card beside the hero. The live ZIP checker stays in this slot; edit title/body only.",
  },
  {
    sectionId: "value-door",
    type: "features",
    badgeText: "",
    title: "Delivered to your door",
    body: "Heavy jugs and bulky paper stay in our van. You get a clean stoop and a restocked cabinet.",
    ctaLabel: "",
    ctaHref: "",
    secondaryCtaLabel: "",
    secondaryCtaHref: "",
    visible: true,
    sortOrder: 2,
    styleVariant: "default",
    intentNotes: "Value prop 1. Keep generic household language; no name-brand products.",
  },
  {
    sectionId: "value-staples",
    type: "features",
    badgeText: "",
    title: "Household staples, not a marketplace",
    body: "Detergent, pods, dish, paper, and everyday cleaners — chosen for regular family use.",
    ctaLabel: "",
    ctaHref: "",
    secondaryCtaLabel: "",
    secondaryCtaHref: "",
    visible: true,
    sortOrder: 3,
    styleVariant: "default",
    intentNotes: "Value prop 2. Describe categories, not brand names.",
  },
  {
    sectionId: "value-rhythm",
    type: "features",
    badgeText: "",
    title: "Order once or set a rhythm",
    body: "Order when the cabinet is running low. Subscriptions will refill the same SKUs on your cadence.",
    ctaLabel: "",
    ctaHref: "",
    secondaryCtaLabel: "",
    secondaryCtaHref: "",
    visible: true,
    sortOrder: 4,
    styleVariant: "default",
    intentNotes: "Value prop 3. Cadence language only; weekly delivery, not rush.",
  },
  {
    sectionId: "featured",
    type: "cta",
    badgeText: "",
    title: "Featured this week",
    body: "Live products from the same inventory database we receive against.",
    ctaLabel: "Shop all",
    ctaHref: "/shop",
    secondaryCtaLabel: "",
    secondaryCtaHref: "",
    visible: true,
    sortOrder: 5,
    styleVariant: "default",
    intentNotes: "Heading above the live featured catalog. Products stay data-driven.",
  },
  {
    sectionId: "how-it-works",
    type: "features",
    badgeText: "How it works",
    title: "How it works",
    body: "Check your ZIP\nFill the cart\nWe bring it by",
    ctaLabel: "",
    ctaHref: "",
    secondaryCtaLabel: "",
    secondaryCtaHref: "",
    visible: true,
    sortOrder: 6,
    styleVariant: "emphasis",
    intentNotes:
      "Step titles. Storefront fills step bodies from delivery settings (counties + weekly window).",
  },
];
