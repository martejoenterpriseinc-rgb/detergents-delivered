import { notFound } from "next/navigation";
import { AccountError } from "@/lib/domain/account";
import { requireRole } from "@/lib/authz";
import { readRouteMileage } from "@/lib/services/route-mileage";
import { RouteMileage } from "@/components/admin/route-mileage";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  let initial;
  try {
    initial = await readRouteMileage(session.user.id, (await params).id);
  } catch (e) {
    if (e instanceof AccountError && [403, 404].includes(e.status)) notFound();
    if (e instanceof AccountError && [409, 422].includes(e.status))
      return (
        <main className="p-5">
          <h1 className="text-2xl font-semibold">Route mileage unavailable</h1>
          <p role="alert">{e.message}</p>
        </main>
      );
    throw e;
  }
  return <RouteMileage initial={initial} />;
}
