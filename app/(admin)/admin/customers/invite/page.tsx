import { requireRole } from "@/lib/authz";
import { InviteCustomer } from "@/components/admin/invite-customer";
export default async function Page() {
  await requireRole("ADMIN", "SUPER_ADMIN");
  return <InviteCustomer />;
}
