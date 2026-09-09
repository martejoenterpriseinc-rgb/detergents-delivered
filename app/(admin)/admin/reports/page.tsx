import Link from "next/link";
export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-teal-950">Reports</h1>
      <p>Open your financial and operational tools above.</p>
      <Link className="ops-button" href="/admin/reports/revenue">
        Revenue report
      </Link>
      <p className="text-sm text-teal-800">
        Tools still awaiting integration show their current availability when opened.
      </p>
    </div>
  );
}
