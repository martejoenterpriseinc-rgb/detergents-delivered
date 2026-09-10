import { requireRole } from "@/lib/authz";
import { readFinance } from "@/lib/services/finance";
import { FinanceWorkspace } from "@/components/admin/finance-workspace";
import { ZodError } from "zod";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  let data;
  try {
    data = await readFinance(session.user.id, "expense", await searchParams);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
  }
  if (!data)
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Expenses</h1>
        <p role="alert">
          Choose valid dates in a range of up to one year and a positive page number.
        </p>
        <a className="ops-button" href="/admin/expenses">
          Reset filters
        </a>
      </div>
    );
  return <FinanceWorkspace data={data} />;
}
