import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { transitionPurchaseOrder, updatePurchaseOrder } from "@/lib/services/purchasing";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  expectedAt: z.string().datetime().optional().nullable(),
  freightCents: z.number().int().optional(),
  feeCents: z.number().int().optional(),
  taxCents: z.number().int().optional(),
  otherCostCents: z.number().int().optional(),
  notes: z.string().optional().nullable(),
  status: z.enum(["ORDERED", "CANCELLED"]).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const purchaseOrder = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      vendor: true,
      items: { include: { productVariant: { include: { product: true } } } },
      receipts: { include: { items: true } },
    },
  });
  if (!purchaseOrder) return Response.json({ error: "purchase order not found" }, { status: 404 });
  return Response.json({ purchaseOrder });
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
    if (body.data.status) {
      const purchaseOrder = await transitionPurchaseOrder(id, body.data.status, gate.session.user.id);
      return Response.json({ purchaseOrder });
    }
    const purchaseOrder = await updatePurchaseOrder(
      id,
      {
        expectedAt: body.data.expectedAt === undefined
          ? undefined
          : body.data.expectedAt
            ? new Date(body.data.expectedAt)
            : null,
        freightCents: body.data.freightCents,
        feeCents: body.data.feeCents,
        taxCents: body.data.taxCents,
        otherCostCents: body.data.otherCostCents,
        notes: body.data.notes,
      },
      gate.session.user.id,
    );
    return Response.json({ purchaseOrder });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
