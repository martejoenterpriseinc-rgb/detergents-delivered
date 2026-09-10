import { jobStatus } from "@/lib/operations/jobs";
import { operationalMediaStatus } from "@/lib/operations/media";
const labels: Record<string, string> = {
  NOT_STARTED: "Not started",
  OFFLINE: "Heartbeat overdue",
  RUNNING: "Running",
  HEALTHY: "Running normally",
  BLOCKED: "Setup required",
  ATTENTION: "Needs attention",
  FAILED: "Retry scheduled",
  WAITING: "Waiting",
};
const reasons: Record<string, string> = {
  PROVIDER_SETUP_REQUIRED: "Complete the provider fields above.",
  DELIVERY_DISABLED: "Scheduled email delivery is not activated.",
  PAYMENT_REVIEW_REQUIRED: "Review protected pending payments in Payments.",
  EMAIL_RETRY_REQUIRED: "Some recovery emails need retry or a fresh customer request.",
  RUN_FAILED:
    "The last run failed. Retries use a delay; inspect service health if this continues.",
};
export async function OperationalHealth() {
  const [jobs, media] = await Promise.all([jobStatus(), operationalMediaStatus()]);
  return (
    <section
      aria-labelledby="operational-health"
      className="rounded-xl border border-teal-100 bg-white p-5"
    >
      <h2 id="operational-health" className="text-lg font-semibold">
        Background jobs & photo storage
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Actual scheduler heartbeats and saved photo usage. Refresh the page for current
        status.
      </p>
      <div className="mt-4 divide-y divide-slate-100">
        {jobs.map((job) => (
          <div
            key={job.name}
            className="flex flex-wrap items-start justify-between gap-3 py-4"
          >
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">
                {job.name === "payment-reconciliation"
                  ? "Payment recovery"
                  : "Password recovery email"}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {job.heartbeatAt
                  ? `Last heartbeat: ${new Date(job.heartbeatAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central`
                  : "No scheduler heartbeat recorded."}
              </p>
              {job.reason && (
                <p className="mt-1 text-xs text-amber-900">
                  {reasons[job.reason] ?? "Review the worker configuration."}
                </p>
              )}
              {(job.checked > 0 || job.attention > 0) && (
                <p className="mt-1 text-xs text-slate-500">
                  Last run: {job.checked} checked · {job.completed} processed ·{" "}
                  {job.attention} needing attention
                </p>
              )}
            </div>
            <span
              className={`rounded-md px-2 py-1 text-xs font-semibold ${["HEALTHY", "RUNNING"].includes(job.state) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
            >
              {labels[job.state]}
            </span>
          </div>
        ))}
        {media.map((item) => (
          <div
            key={item.kind}
            className="flex flex-wrap items-start justify-between gap-3 py-4"
          >
            <div>
              <h3 className="text-sm font-semibold">
                {item.kind === "WEBSITE"
                  ? "Website photos & logos"
                  : item.kind === "CATALOG"
                    ? "Product photos"
                    : "Private delivery proofs"}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {item.count} photos · {(item.bytes / 1048576).toFixed(1)} of{" "}
                {Math.round(item.limit / 1048576)} MB used
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {item.kind === "PROOF"
                  ? "Encrypted and available only to authorized people."
                  : item.kind === "WEBSITE"
                    ? "Public only while shown on the published website. Saved drafts and earlier versions are retained."
                    : "Public only while the linked product is published."}
              </p>
            </div>
            <span
              className={`rounded-md px-2 py-1 text-xs font-semibold ${item.ready && !item.capacityWarning ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
            >
              {!item.ready
                ? "Setup required"
                : item.capacityWarning
                  ? "Increase capacity soon"
                  : "Storage ready"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
