import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { AccountError } from "@/lib/domain/account";
import { readManualRefunds } from "@/lib/services/manual-refunds";
import { ManualRefunds } from "@/components/admin/manual-refunds";
export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  const { orderId } = await params;
  let data;
  try {
    data = await readManualRefunds(session.user.id, orderId);
  } catch (e) {
    if (!(e instanceof AccountError)) throw e;
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-semibold">Cash / Zelle refunds</h1>
        <p role="alert">{e.message}</p>
        <Link href="/admin/payments/manual">Settlements</Link>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Link href="/admin/payments/manual">← Settlements</Link>
      <h1 className="text-3xl font-semibold">Refund {data.number}</h1>
      <p>
        Prepare the item refund, return the exact amount through the original{" "}
        {data.method} method, then record the return receipt. Stock returns are recorded
        separately.
      </p>
      <ManualRefunds data={data} />
    </div>
  );
}
