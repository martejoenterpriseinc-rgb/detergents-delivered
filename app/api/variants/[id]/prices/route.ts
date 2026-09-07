import { z } from "zod";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { createProductPrice } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

const priceSchema = z.object({
  amountCents: z.number().int(),
  kind: z.enum(["RETAIL", "SUBSCRIPTION", "SALE"]).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  currency: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const body = priceSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  try {
    const price = await createProductPrice(
      id,
      {
        amountCents: body.data.amountCents,
        kind: body.data.kind,
        startsAt: body.data.startsAt ? new Date(body.data.startsAt) : undefined,
        endsAt: body.data.endsAt === undefined ? undefined : body.data.endsAt ? new Date(body.data.endsAt) : null,
        currency: body.data.currency,
      },
      gate.session.user.id,
    );
    return Response.json({ price }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
