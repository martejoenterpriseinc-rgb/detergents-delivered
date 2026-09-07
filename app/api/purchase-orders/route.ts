import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { createPurchaseOrder } from "@/lib/services/purchasing";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  vendorId: z.string().min(1),
  expectedAt: z.string().datetime().optional().nullable(),
  freightCents: z.number().int().optional(),
  feeCents: z.number().int().optional(),
  taxCents: z.number().int().optional(),
  otherCostCents: z.number().int().optional(),
  notes: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        productVariantId: z.string(),
        quantityOrdered: z.number().int().positive(),
        unitCostCents: z.number().int(),
        discountCents: z.number().int().optional(),
        freightCents: z.number().int().optional(),
        feeCents: z.number().int().optional(),
        taxCents: z.number().int().optional(),
        otherCostCents: z.number().int().optional(),
      }),
    )
    .optional(),
});

export async function GET() {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    include: { vendor: true, items: true },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ purchaseOrders });
}

export async function POST(request: Request) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  try {
    const purchaseOrder = await createPurchaseOrder(
      {
        ...body.data,
        expectedAt: body.data.expectedAt ? new Date(body.data.expectedAt) : null,
      },
      gate.session.user.id,
    );
    return Response.json({ purchaseOrder }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
