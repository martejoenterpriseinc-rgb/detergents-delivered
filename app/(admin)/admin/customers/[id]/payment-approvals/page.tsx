import { notFound } from "next/navigation";
import { requireRole } from "@/lib/authz";
import { AccountError } from "@/lib/domain/account";
import { readManualPaymentApprovals } from "@/lib/services/manual-payment-approvals";
import { ManualPaymentApprovals } from "@/components/admin/manual-payment-approvals";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  let data;
  try {
    data = await readManualPaymentApprovals(session.user.id, (await params).id);
  } catch (e) {
    if (e instanceof AccountError && [403, 404].includes(e.status)) notFound();
    throw e;
  }
  return <ManualPaymentApprovals data={data} />;
}
