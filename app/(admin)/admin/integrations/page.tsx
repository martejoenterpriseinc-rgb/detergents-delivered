import Link from "next/link";
import type { Route } from "next";
import { requireRole } from "@/lib/authz";
import { getIntegrationStatus } from "@/lib/integrations/status";
import { EnvironmentSettings } from "@/components/admin/environment-settings";
import { OperationalHealth } from "@/components/admin/operational-health";
export const dynamic = "force-dynamic";
export default async function IntegrationsPage() {
  await requireRole("ADMIN", "SUPER_ADMIN");
  const status = await getIntegrationStatus();
  const operations = status.connections.filter((c) => ["documents"].includes(c.id));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Integrations</h1>
        <p className="mt-2 text-sm text-teal-800">
          Manage API credentials and connection status, one row at a time.
        </p>
      </div>
      <EnvironmentSettings />
      <OperationalHealth />
      <section
        aria-label="Operational connections"
        className="overflow-hidden rounded-xl border border-teal-100 bg-white"
      >
        <h2 className="border-b border-teal-100 bg-slate-50 px-5 py-4 text-sm font-semibold">
          Operational connections
        </h2>
        {operations.map((connection) => (
          <details
            key={connection.id}
            className="border-b border-slate-100 last:border-0"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-sm font-semibold">
              <span>{connection.name}</span>
              <span className="text-xs text-amber-800">
                {connection.state === "configuration-needed"
                  ? "Setup required"
                  : "Verification required"}
              </span>
            </summary>
            <div className="space-y-3 px-5 pb-5 text-sm text-teal-800">
              <p>{connection.summary}</p>
              <ul className="list-disc space-y-2 pl-5">
                {connection.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              {connection.action && (
                <Link
                  href={connection.action.href as Route}
                  className="ops-button secondary"
                >
                  {connection.action.label}
                </Link>
              )}
            </div>
          </details>
        ))}
      </section>
      <p className="text-xs text-slate-500">
        Checkout {status.checkoutEnabled ? "configuration present" : "closed"} · Saving
        credentials does not activate customer payments.
      </p>
    </div>
  );
}
