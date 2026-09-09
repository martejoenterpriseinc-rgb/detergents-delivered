import { notFound } from "next/navigation";
import { ProductEditor } from "@/components/admin/product-editor";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  const { id } = await params;
  const [product, categories] = await Promise.all([
    prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        images: {
          select: { id: true, alt: true, isPrimary: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
        },
        variants: {
          where: { deletedAt: null },
          include: {
            prices: { orderBy: { startsAt: "desc" } },
            inventoryBalance: true,
            costLayers: { where: { quantityRemaining: { gt: 0 } } },
          },
        },
      },
    }),
    prisma.category.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
  ]);
  if (!product) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-teal-950">{product.name}</h1>
      <ProductEditor product={product} categories={categories} />
    </div>
  );
}
