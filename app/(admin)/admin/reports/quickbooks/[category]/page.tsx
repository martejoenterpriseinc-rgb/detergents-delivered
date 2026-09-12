import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/authz";
import {
  quickbooksCategories,
  quickbooksOverview,
  quickbooksOverviewRecords,
  type QuickbooksCategory,
} from "@/lib/services/quickbooks-overview";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN", "CPA");
  const { category } = await params;
  if (!Object.hasOwn(quickbooksCategories, category)) notFound();
  const key = category as QuickbooksCategory;
  const data = await quickbooksOverview(session.user.id, (await searchParams).period);
  const records = await quickbooksOverviewRecords(
    session.user.id,
    key,
    data.period.period,
  );
  return (
    <div className="space-y-6">
      <Link
        className="font-semibold underline"
        href={`/admin/reports/quickbooks?period=${data.period.period}`}
      >
        ← QuickBooks dashboard
      </Link>
      <h1 className="text-3xl font-semibold">{quickbooksCategories[key]}</h1>
      <p className="text-4xl font-semibold">{data.counts?.[key] ?? "Unavailable"}</p>
      <p>
        {key === "pending" || key === "corrections"
          ? "All outstanding records, including earlier periods."
          : `Exports confirmed from ${data.period.from} through ${data.period.to} (America/Chicago).`}
      </p>
      <p>
        {key === "pending"
          ? "These exports were submitted or have an uncertain provider outcome. Use the existing reconciliation controls to retrieve provider evidence before retrying."
          : key === "corrections"
            ? "These exports have an unresolved reconciliation issue. A warning does not mean that a correcting transaction has been posted."
            : "Count of Detergents Delivered exports with a confirmed provider record, scoped to the configured company and environment. This is an export count, not a company financial statement."}
      </p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Latest records (up to 50)</h2>
        {records.length === 0 && <p>No matching records available.</p>}
        {records.map((row) => (
          <article key={row.id} className="rounded-xl border p-4 break-words">
            <p className="font-semibold">
              {row.kind}: {row.docNumber}
            </p>
            <p>
              {row.status} · Provider record: {row.externalId ?? "Not confirmed"}
            </p>
            <p>Created: {row.createdAt.toISOString()}</p>
            {row.confirmedAt && <p>Confirmed: {row.confirmedAt.toISOString()}</p>}
            {row.reconciliationIssue && (
              <p className="text-amber-900">{row.reconciliationIssue}</p>
            )}
          </article>
        ))}
      </section>
      <Link
        className="inline-flex min-h-12 items-center rounded-xl bg-teal-700 px-5 font-semibold text-white"
        href={`/admin/reports/quickbooks?period=${data.period.period}#accounting-workflows`}
      >
        Open accounting records and reconciliation
      </Link>
    </div>
  );
}
