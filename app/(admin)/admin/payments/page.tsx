import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { runtimeCommerceConfiguration } from "@/lib/commerce/runtime";
import { formatCents } from "@/lib/domain/money";
import { ReconcileButton } from "@/components/commerce/admin-actions";
export default async function Page() {
  await requireRole("ADMIN", "SUPER_ADMIN");
  const config = await runtimeCommerceConfiguration();
  const rows = await prisma.checkoutAttempt.findMany({
    where: { state: { not: "QUOTED" } },
    include: { order: true, customer: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Payments & checkout recovery</h1>
      <p>
        {config.live ? "Production" : "Sandbox"} checkout:{" "}
        {config.enabled ? "configured" : "closed"}.
      </p>
      {config.missing.length > 0 && (
        <p className="rounded-xl bg-amber-50 p-4">
          Setup needed: {config.missing.join(", ")}. Tax registration and provider
          acceptance are checked separately.
        </p>
      )}
      <Link href="/admin/customers/approvals" className="ops-button">
        Review delivery addresses
      </Link>
      <div className="grid gap-4 sm:grid-cols-3">
        {["PAID", "PROCESSING", "REVIEW"].map((state) => (
          <div key={state} className="rounded-2xl border bg-white p-4">
            <p>{state}</p>
            <strong>{rows.filter((r) => r.state === state).length}</strong>
            <small className="block">In latest 100 checkouts</small>
          </div>
        ))}
      </div>
      {!rows.length && <p>No payment attempts yet.</p>}
      {rows.map((r) => (
        <section
          key={r.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-white p-4"
        >
          <div>
            <strong>{r.order?.number ?? r.id}</strong>
            <p>
              {r.customer.firstName} {r.customer.lastName} · {r.state}
            </p>
            <p>{r.order ? formatCents(r.order.totalCents) : "—"}</p>
            <small>{r.createdAt.toISOString()}</small>
            {r.lastError && <p>Needs payment reconciliation</p>}
          </div>
          {r.stripeSessionId && !["PAID", "EXPIRED", "REFUNDED"].includes(r.state) && (
            <ReconcileButton id={r.id} />
          )}
        </section>
      ))}
    </div>
  );
}
