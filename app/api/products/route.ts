import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { createProduct } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

const createProductSchema = z.object({
  slug: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(160),
  brand: z.string().min(1).max(120),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  form: z.enum(["LIQUID", "POWDER", "PODS", "SHEETS", "OTHER"]).optional(),
  taxCategory: z.string().optional(),
  deliveryCapacityUnits: z.number().int().min(0).optional(),
  allowPreorder: z.boolean().optional(),
  isActive: z.boolean().optional(),
  websiteVisible: z.boolean().optional(),
  featured: z.boolean().optional(),
});

export async function GET() {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: {
      variants: { where: { deletedAt: null }, include: { prices: true, inventoryBalance: true } },
      category: true,
      images: true,
    },
    orderBy: { name: "asc" },
  });
  return Response.json({ products });
}

export async function POST(request: Request) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;

  const body = createProductSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }

  try {
    const product = await createProduct(body.data, gate.session.user.id);
    return Response.json({ product }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
