import { z } from "zod";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { addPurchaseOrderItem, removePurchaseOrderItem } from "@/lib/services/purchasing";

export const dynamic = "force-dynamic";

const addSchema = z.object({
  productVariantId: z.string(),
  quantityOrdered: z.number().int().positive(),
  unitCostCents: z.number().int(),
  discountCents: z.number().int().optional(),
  freightCents: z.number().int().optional(),
  feeCents: z.number().int().optional(),
  taxCents: z.number().int().optional(),
  otherCostCents: z.number().int().optional(),
});

const removeSchema = z.object({
  itemId: z.string(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const body = addSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  try {
    const purchaseOrder = await addPurchaseOrderItem(id, body.data, gate.session.user.id);
    return Response.json({ purchaseOrder }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const body = removeSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  try {
    const purchaseOrder = await removePurchaseOrderItem(id, body.data.itemId, gate.session.user.id);
    return Response.json({ purchaseOrder });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
