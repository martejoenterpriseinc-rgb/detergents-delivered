import { ProductEditor } from "@/components/admin/product-editor";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  const categories = await prisma.category.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-teal-950">New product</h1>
      <ProductEditor categories={categories} />
    </div>
  );
}
