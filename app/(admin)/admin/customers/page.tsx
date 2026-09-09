import { supportKpis } from "@/lib/services/support";
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
  const support = await supportKpis(session.user.id);
  return (
    <CustomerDirectory
      key={JSON.stringify(data.filter)}
      data={data}
      supportCount={support.OPEN + support.IN_PROGRESS + support.WAITING_CUSTOMER}
    />
  );
}
