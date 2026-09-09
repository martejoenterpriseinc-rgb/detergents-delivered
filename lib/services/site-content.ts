import { createHash, randomUUID } from "node:crypto";
import { cache } from "react";
import { Prisma, type PrismaClient, type SiteSection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import {
  DEFAULT_HOME_SECTIONS,
  DEFAULT_SITE_SETTINGS,
  HOME_PAGE_SLUG,
  SiteContentError,
  validateSiteSectionDraft,
  validateSiteDocument,
  siteSettingsSchema,
  documentMediaIds,
  presentationSchema,
  type SiteSectionDraft,
  type SiteSettings,
} from "@/lib/domain/site-content";
import { getPublicDeliveryInfo } from "@/lib/services/delivery-settings";
export { SiteContentError };
type DbClient = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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
  version: number;
  settings: SiteSettings;
  sections: PublishedSiteSection[];
};
function sectionData(section: SiteSectionDraft) {
  const {
    imageId,
    imageAlt,
    imageFit,
    imagePositionX,
    imagePositionY,
    mobileImagePositionX,
    mobileImagePositionY,
    alignment,
    spacing,
    ...copy
  } = validateSiteSectionDraft(section);
  return {
    ...copy,
    presentationJson: json({
      imageId,
      imageAlt,
      imageFit,
      imagePositionX,
      imagePositionY,
      mobileImagePositionX,
      mobileImagePositionY,
      alignment,
      spacing,
    }),
  };
}
function toPublished(section: SiteSection): PublishedSiteSection {
  return {
    ...validateSiteSectionDraft({
      ...section,
      ...((section.presentationJson as object) ?? {}),
    }),
    id: section.id,
    updatedAt: section.updatedAt,
    updatedByUserId: section.updatedByUserId,
  };
}
const inTransaction = <T>(
  db: DbClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
) => ("$transaction" in db ? db.$transaction(run) : run(db));
export async function ensureDefaultSiteContent(db: DbClient = prisma) {
  if (
    await db.sitePage.findUnique({
      where: { slug: HOME_PAGE_SLUG },
      select: { id: true },
    })
  )
    return;
  await inTransaction(db, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(613279109)`;
    if (
      await tx.sitePage.findUnique({
        where: { slug: HOME_PAGE_SLUG },
        select: { id: true },
      })
    )
      return;
    await tx.sitePage.create({
      data: {
        slug: HOME_PAGE_SLUG,
        title: "Home",
        settingsJson: json(DEFAULT_SITE_SETTINGS),
        sections: { create: DEFAULT_HOME_SECTIONS.map(sectionData) },
      },
    });
  });
}
export async function getServiceCounties(): Promise<string[]> {
  return (await getPublicDeliveryInfo()).enabledCountyNames;
}
async function readPage(db: DbClient) {
  await ensureDefaultSiteContent(db);
  const row = await db.sitePage.findUniqueOrThrow({
    where: { slug: HOME_PAGE_SLUG },
    include: { sections: { orderBy: { sortOrder: "asc" } } },
  });
  const page: PublishedSitePage = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    updatedAt: row.updatedAt,
    version: row.version,
    settings: siteSettingsSchema.parse(row.settingsJson ?? {}),
    sections: row.sections.map(toPublished),
  };
  return { page, draft: row.draftJson ? validateSiteDocument(row.draftJson) : null };
}
export const getPublishedHomePage = cache(async (db: DbClient = prisma) => {
  const { page } = await readPage(db);
  return {
    page: {
      ...page,
      sections: page.sections
        .filter((s) => s.visible)
        .map((s) => ({ ...s, intentNotes: "" })),
    },
    counties: await getServiceCounties(),
  };
});
export async function getHomePageForBuilder(db: DbClient = prisma) {
  return { ...(await readPage(db)), counties: await getServiceCounties() };
}
export async function listPublishedHomeRevisions(before?: number, db: DbClient = prisma) {
  const rows = await db.siteRevision.findMany({
    where: {
      page: { slug: HOME_PAGE_SLUG },
      mode: "publish",
      ...(before === undefined ? {} : { version: { lt: before } }),
    },
    select: { version: true, createdAt: true },
    orderBy: { version: "desc" },
    take: 21,
  });
  return {
    revisions: rows.slice(0, 20),
    nextBefore: rows.length > 20 ? rows[19].version : null,
  };
}
export async function readPublishedHomeRevision(version: number, db: DbClient = prisma) {
  const row = await db.siteRevision.findFirst({
    where: { page: { slug: HOME_PAGE_SLUG }, mode: "publish", version },
    select: { contentJson: true, version: true },
  });
  if (!row) throw new AccountError("Published version not found.", 404);
  return { document: validateSiteDocument(row.contentJson), version: row.version };
}
export async function saveHomeDocument(
  input: {
    document: unknown;
    version: number;
    requestKey: string;
    mode: "draft" | "publish";
  },
  actorUserId?: string,
  db: DbClient = prisma,
) {
  const document = validateSiteDocument(input.document);
  if (
    !Number.isSafeInteger(input.version) ||
    input.version < 0 ||
    !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestKey) ||
    !["draft", "publish"].includes(input.mode)
  )
    throw new AccountError("Invalid save request.");
  // A required description keeps meaningful photos accessible; logos use the business name.
  if (document.sections.some((s) => s.visible && s.imageId && !s.imageAlt?.trim()))
    throw new AccountError("Add a photo description before saving.");
  await ensureDefaultSiteContent(db);
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ ...input, document }))
    .digest("hex");
  return inTransaction(db, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(613279109)`;
    const page = await tx.sitePage.findUniqueOrThrow({
      where: { slug: HOME_PAGE_SLUG },
      include: { sections: { orderBy: { sortOrder: "asc" } } },
    });
    const receipt = await tx.siteRevision.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (receipt) {
      if (
        receipt.requestHash !== requestHash ||
        receipt.actorUserId !== (actorUserId ?? null)
      )
        throw new AccountError("This save key was used for different changes.", 409);
      if (page.version !== receipt.version)
        throw new AccountError(
          "A newer version exists. Reload the saved page before making more changes.",
          409,
        );
      return { version: receipt.version, mode: receipt.mode };
    }
    if (page.version !== input.version)
      throw new AccountError(
        "Another editor saved changes. Your edits are still here; reload the saved page before publishing.",
        409,
      );
    const mediaIds = documentMediaIds(document);
    if (
      (await tx.siteMedia.count({ where: { id: { in: mediaIds } } })) !== mediaIds.length
    )
      throw new AccountError(
        "An uploaded photo could not be found. Upload it again.",
        400,
      );
    const version = page.version + 1;
    // Capture the pre-builder publication before the first edit, including private notes
    // and media references. This is a recoverable baseline, never a second publication.
    if (!(await tx.siteRevision.count({ where: { pageId: page.id } }))) {
      const baseline = {
        sections: page.sections.map(toPublished),
        settings: siteSettingsSchema.parse(page.settingsJson ?? {}),
      };
      await tx.siteRevision.create({
        data: {
          pageId: page.id,
          version: page.version,
          mode: "publish",
          requestKey: `baseline-${randomUUID()}`,
          requestHash: createHash("sha256")
            .update(JSON.stringify(baseline))
            .digest("hex"),
          contentJson: json(baseline),
          createdAt: page.updatedAt,
        },
      });
    }
    if (input.mode === "publish") {
      await tx.siteSection.deleteMany({
        where: {
          pageId: page.id,
          sectionId: { notIn: document.sections.map((s) => s.sectionId) },
        },
      });
      for (const section of document.sections) {
        const data = { ...sectionData(section), updatedByUserId: actorUserId };
        await tx.siteSection.upsert({
          where: { pageId_sectionId: { pageId: page.id, sectionId: section.sectionId } },
          update: data,
          create: { ...data, pageId: page.id },
        });
      }
      await tx.sitePage.update({
        where: { id: page.id },
        data: {
          version,
          settingsJson: json(document.settings),
          draftJson: Prisma.DbNull,
        },
      });
    } else {
      await tx.sitePage.update({
        where: { id: page.id },
        data: { version, draftJson: json(document) },
      });
    }
    await tx.siteRevision.create({
      data: {
        pageId: page.id,
        requestKey: input.requestKey,
        requestHash,
        version,
        mode: input.mode,
        contentJson: json(document),
        actorUserId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: `site.page.${input.mode === "publish" ? "publish" : "draft.saved"}`,
        entityType: "SitePage",
        entityId: page.id,
        beforeJson: { version: page.version },
        afterJson: json({ version, ...document }),
      },
    });
    return { version, mode: input.mode };
  });
}
// Internal compatibility for seed scripts. HTTP writes always require an explicit version.
export async function publishHomeSections(
  input: unknown,
  actorUserId?: string,
  db: DbClient = prisma,
) {
  const { page } = await readPage(db);
  await saveHomeDocument(
    {
      document: { sections: input, settings: page.settings },
      version: page.version,
      requestKey: randomUUID(),
      mode: "publish",
    },
    actorUserId,
    db,
  );
  return { page: (await readPage(db)).page };
}
export async function publishedMediaExists(id: string) {
  const page = await prisma.sitePage.findUnique({
    where: { slug: HOME_PAGE_SLUG },
    include: { sections: { where: { visible: true } } },
  });
  if (!page) return false;
  if (siteSettingsSchema.parse(page.settingsJson ?? {}).logoId === id) return true;
  return page.sections.some(
    (s) => presentationSchema.parse(s.presentationJson ?? {}).imageId === id,
  );
}
