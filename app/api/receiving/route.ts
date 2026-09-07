import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { receiveAgainstPurchaseOrder } from "@/lib/services/receiving";

export const dynamic = "force-dynamic";

const receiveSchema = z.object({
  purchaseOrderId: z.string(),
  notes: z.string().optional().nullable(),
  receivedAt: z.string().datetime().optional(),
  lines: z
    .array(
      z.object({
        purchaseOrderItemId: z.string(),
        quantityReceived: z.number().int().nonnegative(),
        quantityDamaged: z.number().int().nonnegative().optional(),
        quantityShortage: z.number().int().nonnegative().optional(),
        quantityOverage: z.number().int().nonnegative().optional(),
        unitCostCents: z.number().int().optional(),
        costDiscrepancyNotes: z.string().optional().nullable(),
      }),
    )
    .min(1),
});

export async function GET(request: Request) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ["ORDERED", "SUBMITTED", "PARTIALLY_RECEIVED"] },
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { items: { some: { productVariant: { sku: { contains: q, mode: "insensitive" } } } } },
              { items: { some: { productVariant: { upc: { contains: q, mode: "insensitive" } } } } },
            ],
          }
        : {}),
    },
    include: {
      vendor: true,
      items: { include: { productVariant: { include: { product: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return Response.json({ purchaseOrders });
}

export async function POST(request: Request) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const body = receiveSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  try {
    const receipt = await receiveAgainstPurchaseOrder(
      {
        ...body.data,
        receivedAt: body.data.receivedAt ? new Date(body.data.receivedAt) : undefined,
      },
      gate.session.user.id,
    );
    return Response.json({ receipt }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
