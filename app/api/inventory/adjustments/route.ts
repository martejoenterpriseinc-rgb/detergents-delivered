import { z } from "zod";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { createInventoryAdjustment } from "@/lib/services/inventory";

export const dynamic = "force-dynamic";

const adjustmentSchema = z.object({
  productVariantId: z.string(),
  quantity: z.number().int(),
  reason: z.string().min(1),
  notes: z.string().optional().nullable(),
  type: z.enum(["ADJUSTMENT", "COUNT", "LOSS", "DAMAGE"]).optional(),
  occurredAt: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const body = adjustmentSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  try {
    const result = await createInventoryAdjustment({
      ...body.data,
      occurredAt: body.data.occurredAt ? new Date(body.data.occurredAt) : undefined,
      actorUserId: gate.session.user.id,
    });
    return Response.json({ transaction: result.txn, balance: result.balance }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
