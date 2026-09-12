import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { readManualCheckouts } from "@/lib/services/manual-checkout";
import { ManualSettlementRow } from "@/components/admin/manual-settlements";
import { AccountError } from "@/lib/domain/account";
export default async function Page() {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  let data;
  try {
    data = await readManualCheckouts(session.user.id);
  } catch (e) {
    if (!(e instanceof AccountError)) throw e;
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-semibold">Cash / Zelle settlements</h1>
        <p role="alert">{e.message}</p>
        <Link href="/admin/payments">Payments</Link>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Link href="/admin/payments">← Payments</Link>
      <h1 className="text-3xl font-semibold">Cash / Zelle settlements</h1>
      <p>
        Latest 100 approved manual checkouts. Verify received money first, then reconcile
        tax and complete settlement. Customer approval alone never marks an order paid.
      </p>
      {!data.rows.length && <p>No manual checkouts yet.</p>}
      {data.rows.map((row) => (
        <ManualSettlementRow key={row.id} row={row} canWrite={data.canWrite} />
      ))}
    </div>
  );
}
