import { prisma } from "@/lib/prisma";
import { loadCatalogImage } from "@/lib/services/catalog-images";

export const dynamic = "force-dynamic";

/**
 * Public catalog images only — the product must be website-visible.
 * Private / unpublished assets are not served here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const image = await prisma.productImage.findUnique({
    where: { id },
    include: { product: true, productVariant: { include: { product: true } } },
  });
  if (!image) return Response.json({ error: "not found" }, { status: 404 });
  const product = image.product ?? image.productVariant?.product;
  if (!product || !product.isActive || !product.websiteVisible || product.deletedAt) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  try {
    const bytes = await loadCatalogImage(image.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    });
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
