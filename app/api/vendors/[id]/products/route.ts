import { z } from "zod";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { upsertVendorProduct } from "@/lib/services/vendors";

export const dynamic = "force-dynamic";

const schema = z.object({
  productVariantId: z.string(),
  vendorSku: z.string().optional().nullable(),
  unitCostCents: z.number().int().optional().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  try {
    const vendorProduct = await upsertVendorProduct(
      { vendorId: id, ...body.data },
      gate.session.user.id,
    );
    return Response.json({ vendorProduct }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
