import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { createCategory } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

const createCategorySchema = z.object({
  slug: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  parentId: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;

  const categories = await prisma.category.findMany({
    where: { deletedAt: null },
    include: { parent: true, children: { where: { deletedAt: null } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return Response.json({ categories });
}

export async function POST(request: Request) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;

  const body = createCategorySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }

  try {
    const category = await createCategory(body.data, gate.session.user.id);
    return Response.json({ category }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
