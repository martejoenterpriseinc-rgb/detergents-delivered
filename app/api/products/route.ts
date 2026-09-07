import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const createProductSchema = z.object({
  slug: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  brand: z.string().min(1).max(120),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  form: z.enum(["LIQUID", "POWDER", "PODS", "SHEETS", "OTHER"]).optional(),
});

export async function GET() {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: { variants: { where: { deletedAt: null } }, category: true },
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

  const product = await prisma.product.create({ data: body.data });
  return Response.json({ product }, { status: 201 });
}
