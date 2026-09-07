import { z } from "zod";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { addProductImage } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

const imageSchema = z.object({
  storageKey: z.string().min(1),
  productVariantId: z.string().optional(),
  alt: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isPrimary: z.boolean().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const body = imageSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  try {
    const image = await addProductImage(
      {
        productId: id,
        productVariantId: body.data.productVariantId,
        storageKey: body.data.storageKey,
        alt: body.data.alt,
        sortOrder: body.data.sortOrder,
        isPrimary: body.data.isPrimary,
      },
      gate.session.user.id,
    );
    return Response.json({ image }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
