import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { deleteVendor, updateVendor } from "@/lib/services/vendors";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  contactName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  const vendor = await prisma.vendor.findFirst({
    where: { id, deletedAt: null },
    include: { products: { include: { productVariant: true } }, purchaseOrders: true },
  });
  if (!vendor) return Response.json({ error: "vendor not found" }, { status: 404 });
  return Response.json({ vendor });
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
    const vendor = await updateVendor(
      id,
      { ...body.data, email: body.data.email === "" ? null : body.data.email },
      gate.session.user.id,
    );
    return Response.json({ vendor });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id } = await params;
  try {
    const vendor = await deleteVendor(id, gate.session.user.id);
    return Response.json({ vendor });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
