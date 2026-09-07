import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { deleteVariant, updateVariant } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  sku: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(160).optional(),
  upc: z.string().max(32).optional().nullable(),
  scent: z.string().optional().nullable(),
  sizeLabel: z.string().optional().nullable(),
  sizeValue: z.number().optional().nullable(),
  sizeUnit: z.string().optional().nullable(),
  weightValue: z.number().optional().nullable(),
  weightUnit: z.string().optional().nullable(),
  lengthIn: z.number().optional().nullable(),
  widthIn: z.number().optional().nullable(),
  heightIn: z.number().optional().nullable(),
  uom: z.string().optional().nullable(),
  casePack: z.number().int().optional().nullable(),
  taxCategory: z.string().optional().nullable(),
  reorderPoint: z.number().int().optional().nullable(),
  reorderQty: z.number().int().optional().nullable(),
  deliveryCapacityUnits: z.number().int().optional().nullable(),
  isActive: z.boolean().optional(),
  websiteVisible: z.boolean().optional(),
  featured: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const variant = await prisma.productVariant.findFirst({
    where: { id, deletedAt: null },
    include: {
      product: true,
      prices: { orderBy: { startsAt: "desc" } },
      inventoryBalance: true,
      costLayers: true,
    },
  });
  if (!variant) return Response.json({ error: "variant not found" }, { status: 404 });
  return Response.json({ variant });
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
    const variant = await updateVariant(id, body.data, gate.session.user.id);
    return Response.json({ variant });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  try {
    const variant = await deleteVariant(id, gate.session.user.id);
    return Response.json({ variant });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
