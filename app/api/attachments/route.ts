import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  entityType: z.enum(["VENDOR", "PURCHASE_ORDER", "RECEIPT", "PRODUCT"]),
  entityId: z.string(),
  storageKey: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().optional(),
  byteSize: z.number().int().optional(),
  notes: z.string().optional(),
});

export async function GET(request: Request) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "CPA", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if (!entityType || !entityId) {
    return Response.json({ error: "entityType and entityId are required" }, { status: 400 });
  }
  const attachments = await prisma.attachment.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ attachments });
}

export async function POST(request: Request) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });
  }
  const attachment = await prisma.attachment.create({ data: body.data });
  return Response.json({ attachment }, { status: 201 });
}
