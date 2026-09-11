import { requireRole } from "@/lib/authz";
import { quickbooksConnectionStatus } from "@/lib/services/quickbooks-connection";
import { QuickbooksConnection } from "@/components/admin/quickbooks-connection";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ connection?: string }>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  return (
    <QuickbooksConnection
      status={await quickbooksConnectionStatus(session.user.id)}
      callback={(await searchParams).connection}
    />
  );
}
