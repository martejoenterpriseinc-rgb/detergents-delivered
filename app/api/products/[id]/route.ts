import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { deleteProduct, updateProduct } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  slug: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(160).optional(),
  brand: z.string().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  form: z.enum(["LIQUID", "POWDER", "PODS", "SHEETS", "OTHER"]).optional(),
  taxCategory: z.string().nullable().optional(),
  deliveryCapacityUnits: z.number().int().min(0).optional(),
  allowPreorder: z.boolean().optional(),
  isActive: z.boolean().optional(),
  websiteVisible: z.boolean().optional(),
  featured: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    include: {
      category: true,
      images: true,
      variants: {
        where: { deletedAt: null },
        include: {
          prices: { orderBy: { startsAt: "desc" } },
          images: true,
          inventoryBalance: true,
          costLayers: { where: { quantityRemaining: { gt: 0 } } },
          vendorProducts: { include: { vendor: true } },
        },
      },
    },
  });
  if (!product) return Response.json({ error: "product not found" }, { status: 404 });
  return Response.json({ product });
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
    const product = await updateProduct(id, body.data, gate.session.user.id);
    return Response.json({ product });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  try {
    const product = await deleteProduct(id, gate.session.user.id);
    return Response.json({ product });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
