import { CategoryManager } from "@/components/admin/category-manager";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  await requireRole("ADMIN", "INVENTORY", "SUPER_ADMIN");
  const categories = await prisma.category.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Categories</h1>
        <p className="mt-2 text-sm text-teal-800">
          Category and subcategory tree. Products inherit browse paths from here.
        </p>
      </div>
      <CategoryManager categories={categories} />
    </div>
  );
}
