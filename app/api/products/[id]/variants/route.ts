import { z } from "zod";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { createVariant } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

const variantSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const body = variantSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  try {
    const variant = await createVariant(id, body.data, gate.session.user.id);
    return Response.json({ variant }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
