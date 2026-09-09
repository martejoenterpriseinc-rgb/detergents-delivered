import { requireRole } from "@/lib/authz";
import { customerDirectory } from "@/lib/services/operations";
import { CustomerDirectory } from "@/components/admin/customer-directory";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN");
  const data = await customerDirectory(session.user.id, await searchParams);
  return <CustomerDirectory key={JSON.stringify(data.filter)} data={data} />;
}
