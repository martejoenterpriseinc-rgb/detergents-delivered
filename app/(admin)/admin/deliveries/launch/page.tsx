import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { launchDemand } from "@/lib/services/launch";
export default async function Page() {
  const session = await requireRole("ADMIN", "SUPER_ADMIN");
  const data = await launchDemand(session.user.id);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Launch demand & route planning</h1>
      <Link href="/admin/settings/launch" className="ops-button">
        Launch & capacity settings
      </Link>
      <p>
        Paid, unscheduled orders placed through {data.config.cutoffDate}, grouped into
        proposed dates using each address’s zone and the saved cadence. These are planning
        suggestions, not reservations. Product loads use current catalog settings;
        checkout load snapshots and payment verification must be connected before
        automatic booking.
      </p>
      <p className="rounded-xl bg-amber-50 p-4">
        {data.config.enabled
          ? `Planning window: ${data.config.launchDate}–${data.config.firstDeliveryBy}.`
          : "Launch window is disabled."}{" "}
        No customer has been charged, notified or rescheduled by this page.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-teal-100 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr>
              {["Order", "Customer", "City / ZIP", "Area", "Proposed date", "Review"].map(
                (v) => (
                  <th key={v} className="p-3">
                    {v}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-t border-teal-100">
                <td className="p-3">{r.number}</td>
                <td className="p-3">{r.customer}</td>
                <td className="p-3">
                  {r.city} {r.postalCode}
                </td>
                <td className="p-3">{r.zone}</td>
                <td className="p-3">{r.proposedDate ?? "Needs review"}</td>
                <td className="p-3">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.rows.length && (
          <p className="p-6">
            No qualifying paid, unscheduled orders. Interest enquiries and unpaid orders
            are not counted as purchases.
          </p>
        )}
      </div>
    </div>
  );
}
