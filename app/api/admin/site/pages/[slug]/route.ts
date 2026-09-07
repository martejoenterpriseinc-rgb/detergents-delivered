import { z } from "zod";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { WEBSITE_MANAGER_ROLES, HOME_PAGE_SLUG } from "@/lib/domain/site-content";
import { getHomePageForBuilder, publishHomeSections } from "@/lib/services/site-content";

export const dynamic = "force-dynamic";

const publishSchema = z.object({
  sections: z.array(z.unknown()),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const gate = await requireApiRole([...WEBSITE_MANAGER_ROLES]);
  if (gate.error) return gate.error;

  const { slug } = await params;
  if (slug !== HOME_PAGE_SLUG) {
    return Response.json({ error: "page not found" }, { status: 404 });
  }

  try {
    const data = await getHomePageForBuilder();
    return Response.json(data);
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const gate = await requireApiRole([...WEBSITE_MANAGER_ROLES]);
  if (gate.error) return gate.error;

  const { slug } = await params;
  if (slug !== HOME_PAGE_SLUG) {
    return Response.json({ error: "page not found" }, { status: 404 });
  }

  const body = publishSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }

  try {
    const result = await publishHomeSections(body.data.sections, gate.session.user.id);
    return Response.json(result);
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
