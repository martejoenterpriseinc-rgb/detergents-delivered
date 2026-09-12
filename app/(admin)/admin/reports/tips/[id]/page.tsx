import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { financeAccess } from "@/lib/services/finance";
import { readTipAccounting } from "@/lib/services/tip-payouts";
import { TipPayoutForm } from "@/components/admin/tip-payout-form";
import { AccountError } from "@/lib/domain/account";
const money = (n: number | null) =>
  n === null ? "Needs allocation review" : `$${(n / 100).toFixed(2)}`;
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  const canWrite = await financeAccess(prisma, session.user.id);
  const { id } = await params;
  let data;
  try {
    data = await readTipAccounting(session.user.id, id);
  } catch (error) {
    if (!(error instanceof AccountError)) throw error;
    return (
      <div className="space-y-5">
        <Link href="/admin/reports/tips">← Delivery tips</Link>
        <h1 className="text-3xl font-semibold">Tip accounting</h1>
        <p role="alert">{error.message}</p>
        <p>
          Accounting requires the original verified tip and a current provider refund
          check. No transfer was recorded.
        </p>
      </div>
    );
  }
  const reversible = data.entries.filter(
    (e) => e.kind === "PAYMENT" && !data.entries.some((r) => r.reversalOfId === e.id),
  );
  return (
    <div className="max-w-4xl space-y-5">
      <Link href="/admin/reports/tips">← Delivery tips</Link>
      <h1 className="text-3xl font-semibold">Tip accounting</h1>
      <p className="break-all">Driver: {data.driver}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <p>Original tip: {money(data.amountCents)}</p>
        <p>Refunded cash including tax: {money(data.refundedCashCents)}</p>
        <p>Net driver transfers: {money(data.paidCents)}</p>
        <p>Available to pay: {money(data.disputed ? 0 : data.payableCents)}</p>
        <p>Recoverable from driver: {money(data.recoverableCents)}</p>
      </div>
      {(data.review || data.disputed) && (
        <p role="alert">
          New payouts are blocked while a partial refund, pending refund, or dispute needs
          review.
        </p>
      )}
      <p>
        Provider refund check: {data.checkedAt}. Refunded cash does not establish provider
        tax correction acceptance. Partial refunds require a verified tip/tax allocation
        before further payout.
      </p>
      <h2 className="text-xl font-semibold">Provider refunds</h2>
      {!data.refunds.length && <p>No provider refunds found.</p>}
      {data.refunds.map((r) => (
        <p key={r.id}>
          {r.id} · {r.state} · {money(r.amountCents)}
        </p>
      ))}
      <h2 className="text-xl font-semibold">Driver transfer history</h2>
      {!data.entries.length && <p>No transfers recorded.</p>}
      {data.entries.map((e) => (
        <article key={e.id} className="rounded-xl border p-4 break-words">
          <p>
            {e.paidOn} · {e.kind} · {money(e.amountCents)}
          </p>
          <p>{e.reference}</p>
          <p>{e.reason}</p>
        </article>
      ))}
      {canWrite && <TipPayoutForm tipId={id} transfers={reversible} />}
    </div>
  );
}
