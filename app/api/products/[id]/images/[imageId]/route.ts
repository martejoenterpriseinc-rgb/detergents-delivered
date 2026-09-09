import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/api-auth";
import { loadCatalogImage } from "@/lib/services/catalog-images";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;
  const { id, imageId } = await params;
  const photo = await prisma.productImage.findFirst({
    where: { id: imageId, productId: id, product: { deletedAt: null } },
    select: { storageKey: true },
  });
  if (!photo) return Response.json({ error: "Photo not found." }, { status: 404 });
  try {
    return new Response(new Uint8Array(await loadCatalogImage(photo.storageKey)), {
      headers: {
        "Content-Type": "image/jpeg",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return Response.json({ error: "Photo unavailable." }, { status: 404 });
  }
}
