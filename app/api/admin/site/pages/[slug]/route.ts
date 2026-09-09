import { z } from "zod";
import { requireApiRole } from "@/lib/api-auth";
import { accountFailure, accountJson } from "@/lib/account-api";
import { readSiteJson } from "@/lib/site-api";
import {
  WEBSITE_MANAGER_ROLES,
  HOME_PAGE_SLUG,
  SiteContentError,
} from "@/lib/domain/site-content";
import {
  getHomePageForBuilder,
  saveHomeDocument,
  listPublishedHomeRevisions,
  readPublishedHomeRevision,
} from "@/lib/services/site-content";
export const dynamic = "force-dynamic";
const saveSchema = z.object({
  document: z.unknown(),
  version: z.number().int().nonnegative(),
  requestKey: z.string().uuid(),
  mode: z.enum(["draft", "publish"]),
});
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const gate = await requireApiRole([...WEBSITE_MANAGER_ROLES]);
  if (gate.error) return gate.error;
  if ((await params).slug !== HOME_PAGE_SLUG)
    return accountJson({ error: "Page not found." }, 404);
  try {
    const query = new URL(request.url).searchParams;
    if (query.has("revision")) {
      const value = z
        .string()
        .regex(/^\d{1,10}$/)
        .transform(Number)
        .parse(query.get("revision"));
      return accountJson(await readPublishedHomeRevision(value));
    }
    if (query.get("history") === "1") {
      const before = query.has("before")
        ? z
            .string()
            .regex(/^\d{1,10}$/)
            .transform(Number)
            .parse(query.get("before"))
        : undefined;
      return accountJson(await listPublishedHomeRevisions(before));
    }
    return accountJson(await getHomePageForBuilder());
  } catch (error) {
    return accountFailure(error);
  }
}
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const gate = await requireApiRole([...WEBSITE_MANAGER_ROLES]);
  if (gate.error) return gate.error;
  if ((await params).slug !== HOME_PAGE_SLUG)
    return accountJson({ error: "Page not found." }, 404);
  try {
    return accountJson(
      await saveHomeDocument(
        saveSchema.parse(await readSiteJson(request)),
        gate.session.user.id,
      ),
    );
  } catch (error) {
    return error instanceof SiteContentError
      ? accountJson({ error: error.message }, 400)
      : accountFailure(error);
  }
}
