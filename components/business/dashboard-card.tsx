import Link from "next/link";
import { getBusinessSetup } from "@/lib/business/service";
import { activePlan, structureNames } from "@/lib/business/domain";
import { AccountError } from "@/lib/domain/account";
export async function BusinessSetupCard({
  userId,
  showCompleted = false,
}: {
  userId: string;
  showCompleted?: boolean;
}) {
  const setup = await getBusinessSetup(userId).catch((e) => {
    if (e instanceof AccountError && e.status === 403) return null;
    throw e;
  });
  if (!setup) return null;
  const plan = activePlan(setup.data);
  if (plan?.completedAt && !showCompleted) return null;
  return (
    <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-teal-200 bg-teal-50 p-5">
      <div>
        <p role="status" className="text-sm font-semibold">
          {setup.progress.percent}% complete
        </p>
        <progress
          aria-label="Business setup completeness"
          max={100}
          value={setup.progress.percent}
          className="w-full"
        />
        <p className="font-semibold text-teal-950">
          {plan?.completedAt
            ? "Business setup checklist complete"
            : "Continue Business Setup"}
        </p>
        <p className="mt-1 text-sm text-teal-800">
          {plan
            ? `${structureNames[plan.structure]} • ${setup.progress.completed}/${setup.progress.total} requirements complete`
            : "Choose a structure, track filings and keep private business records."}
        </p>
        {setup.progress.deadlines[0] && (
          <p className="mt-1 text-xs">
            Next: {setup.progress.deadlines[0].date} — {setup.progress.deadlines[0].label}
          </p>
        )}
      </div>
      <Link className="ops-button" href="/admin/settings/business/setup">
        {plan?.completedAt ? "View business records" : "Continue Business Setup"}
      </Link>
    </section>
  );
}
