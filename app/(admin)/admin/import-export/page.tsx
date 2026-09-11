import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { catalogFileAccess } from "@/lib/services/catalog-file";
import { CatalogFiles } from "@/components/admin/catalog-files";
export default async function Page() {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "INVENTORY", "CPA");
  const canImport = await catalogFileAccess(prisma, session.user.id);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-teal-950">Import / Export</h1>
      <CatalogFiles canImport={canImport} />
      {session.user.roles.some((role) =>
        ["ADMIN", "SUPER_ADMIN", "CPA"].includes(role),
      ) && (
        <section className="space-y-3 rounded-xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Accounting exports</h2>
          <p className="text-sm">
            Choose dates and export source records from the corresponding workspace.
          </p>
          <div className="flex flex-wrap gap-3">
            <a className="underline" href="/admin/expenses">
              Expenses
            </a>
            <a className="underline" href="/admin/mileage">
              Mileage
            </a>
            <a className="underline" href="/admin/cpa">
              CPA Center
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
