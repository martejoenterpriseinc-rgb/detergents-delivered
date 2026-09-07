import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_HOME_SECTIONS,
  HOME_PAGE_SLUG,
  SiteContentError,
  validateSiteSectionDraft,
  validateSiteSectionDrafts,
  type SiteSectionDraft,
} from "@/lib/domain/site-content";
import { getPublicDeliveryInfo } from "@/lib/services/delivery-settings";

export { SiteContentError };

type DbClient = PrismaClient | Prisma.TransactionClient;

export type PublishedSiteSection = SiteSectionDraft & {
  id: string;
  updatedAt: Date;
  updatedByUserId: string | null;
};

export type PublishedSitePage = {
  id: string;
  slug: string;
  title: string;
  updatedAt: Date;
  sections: PublishedSiteSection[];
};

function toDraft(section: {
  sectionId: string;
  type: string;
  title: string | null;
  body: string | null;
  badgeText: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  secondaryCtaLabel: string | null;
  secondaryCtaHref: string | null;
  visible: boolean;
  sortOrder: number;
  styleVariant: string | null;
  intentNotes: string | null;
}): SiteSectionDraft {
  return validateSiteSectionDraft({
    sectionId: section.sectionId,
    type: section.type,
    title: section.title ?? "",
    body: section.body ?? "",
    badgeText: section.badgeText ?? "",
    ctaLabel: section.ctaLabel ?? "",
    ctaHref: section.ctaHref ?? "",
    secondaryCtaLabel: section.secondaryCtaLabel ?? "",
    secondaryCtaHref: section.secondaryCtaHref ?? "",
    visible: section.visible,
    sortOrder: section.sortOrder,
    styleVariant: section.styleVariant ?? "default",
    intentNotes: section.intentNotes ?? "",
  });
}

function toPublished(section: {
  id: string;
  updatedAt: Date;
  updatedByUserId: string | null;
} & Parameters<typeof toDraft>[0]): PublishedSiteSection {
  return {
    ...toDraft(section),
    id: section.id,
    updatedAt: section.updatedAt,
    updatedByUserId: section.updatedByUserId,
  };
}

export async function getServiceCounties(): Promise<string[]> {
  const delivery = await getPublicDeliveryInfo();
  return delivery.enabledCountyNames;
}

async function seedHomeIfNeeded(db: DbClient) {
  const existing = await db.sitePage.findUnique({
    where: { slug: HOME_PAGE_SLUG },
    include: { sections: true },
  });
  if (!existing) {
    await db.sitePage.create({
      data: {
        slug: HOME_PAGE_SLUG,
        title: "Home",
        sections: {
          create: DEFAULT_HOME_SECTIONS.map((section) => ({
            sectionId: section.sectionId,
            type: section.type,
            title: section.title,
            body: section.body,
            badgeText: section.badgeText || null,
            ctaLabel: section.ctaLabel || null,
            ctaHref: section.ctaHref || null,
            secondaryCtaLabel: section.secondaryCtaLabel || null,
            secondaryCtaHref: section.secondaryCtaHref || null,
            visible: section.visible,
            sortOrder: section.sortOrder,
            styleVariant: section.styleVariant,
            intentNotes: section.intentNotes || null,
          })),
        },
      },
    });
  } else if (existing.sections.length === 0) {
    await db.siteSection.createMany({
      data: DEFAULT_HOME_SECTIONS.map((section) => ({
        pageId: existing.id,
        sectionId: section.sectionId,
        type: section.type,
        title: section.title,
        body: section.body,
        badgeText: section.badgeText || null,
        ctaLabel: section.ctaLabel || null,
        ctaHref: section.ctaHref || null,
        secondaryCtaLabel: section.secondaryCtaLabel || null,
        secondaryCtaHref: section.secondaryCtaHref || null,
        visible: section.visible,
        sortOrder: section.sortOrder,
        styleVariant: section.styleVariant,
        intentNotes: section.intentNotes || null,
      })),
    });
  }

}

export async function ensureDefaultSiteContent(db: DbClient = prisma) {
  await seedHomeIfNeeded(db);
}

export async function getPublishedHomePage(db: DbClient = prisma): Promise<{
  page: PublishedSitePage;
  counties: string[];
}> {
  await ensureDefaultSiteContent(db);
  const page = await db.sitePage.findUniqueOrThrow({
    where: { slug: HOME_PAGE_SLUG },
    include: { sections: { orderBy: { sortOrder: "asc" } } },
  });
  const counties = await getServiceCounties();
  return {
    page: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      updatedAt: page.updatedAt,
      sections: page.sections.filter((section) => section.visible).map(toPublished),
    },
    counties,
  };
}

export async function getHomePageForBuilder(db: DbClient = prisma): Promise<{
  page: PublishedSitePage;
  counties: string[];
}> {
  await ensureDefaultSiteContent(db);
  const page = await db.sitePage.findUniqueOrThrow({
    where: { slug: HOME_PAGE_SLUG },
    include: { sections: { orderBy: { sortOrder: "asc" } } },
  });
  const counties = await getServiceCounties();
  return {
    page: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      updatedAt: page.updatedAt,
      sections: page.sections.map(toPublished),
    },
    counties,
  };
}

export async function publishHomeSections(
  input: unknown,
  actorUserId?: string,
  db: DbClient = prisma,
) {
  const drafts = validateSiteSectionDrafts(input);
  await ensureDefaultSiteContent(db);

  const run = async (tx: Prisma.TransactionClient) => {
    const page = await tx.sitePage.findUniqueOrThrow({
      where: { slug: HOME_PAGE_SLUG },
      include: { sections: { orderBy: { sortOrder: "asc" } } },
    });
    const before = page.sections.map(toPublished);

    const incomingIds = new Set(drafts.map((draft) => draft.sectionId));
    const removed = page.sections.filter((section) => !incomingIds.has(section.sectionId));
    if (removed.length > 0) {
      await tx.siteSection.deleteMany({
        where: { id: { in: removed.map((section) => section.id) } },
      });
    }

    for (const draft of drafts) {
      await tx.siteSection.upsert({
        where: {
          pageId_sectionId: { pageId: page.id, sectionId: draft.sectionId },
        },
        update: {
          type: draft.type,
          title: draft.title || null,
          body: draft.body || null,
          badgeText: draft.badgeText || null,
          ctaLabel: draft.ctaLabel || null,
          ctaHref: draft.ctaHref || null,
          secondaryCtaLabel: draft.secondaryCtaLabel || null,
          secondaryCtaHref: draft.secondaryCtaHref || null,
          visible: draft.visible,
          sortOrder: draft.sortOrder,
          styleVariant: draft.styleVariant,
          intentNotes: draft.intentNotes || null,
          updatedByUserId: actorUserId,
        },
        create: {
          pageId: page.id,
          sectionId: draft.sectionId,
          type: draft.type,
          title: draft.title || null,
          body: draft.body || null,
          badgeText: draft.badgeText || null,
          ctaLabel: draft.ctaLabel || null,
          ctaHref: draft.ctaHref || null,
          secondaryCtaLabel: draft.secondaryCtaLabel || null,
          secondaryCtaHref: draft.secondaryCtaHref || null,
          visible: draft.visible,
          sortOrder: draft.sortOrder,
          styleVariant: draft.styleVariant,
          intentNotes: draft.intentNotes || null,
          updatedByUserId: actorUserId,
        },
      });
    }

    await tx.sitePage.update({
      where: { id: page.id },
      data: { updatedAt: new Date() },
    });

    const afterPage = await tx.sitePage.findUniqueOrThrow({
      where: { id: page.id },
      include: { sections: { orderBy: { sortOrder: "asc" } } },
    });
    const after = afterPage.sections.map(toPublished);

    await writeAuditLog(tx, {
      actorUserId,
      action: "site.page.publish",
      entityType: "SitePage",
      entityId: page.id,
      beforeJson: before as unknown as Prisma.InputJsonValue,
      afterJson: after as unknown as Prisma.InputJsonValue,
    });

    return {
      page: {
        id: afterPage.id,
        slug: afterPage.slug,
        title: afterPage.title,
        updatedAt: afterPage.updatedAt,
        sections: after,
      },
    };
  };

  if ("$transaction" in db) {
    return db.$transaction(run);
  }
  return run(db);
}
