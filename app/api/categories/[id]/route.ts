import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { deleteCategory, updateCategory } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  slug: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const category = await prisma.category.findFirst({
    where: { id, deletedAt: null },
    include: { parent: true, children: { where: { deletedAt: null } }, products: true },
  });
  if (!category) return Response.json({ error: "category not found" }, { status: 404 });
  return Response.json({ category });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const body = updateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  try {
    const category = await updateCategory(id, body.data, gate.session.user.id);
    return Response.json({ category });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  try {
    const category = await deleteCategory(id, gate.session.user.id);
    return Response.json({ category });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
