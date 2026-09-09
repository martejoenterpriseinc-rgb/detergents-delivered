import Link from "next/link";
import type { Route } from "next";
import {
  CreditCard,
  KeyRound,
  Mail,
  MapPin,
  Images,
  FileLock2,
  Calculator,
  MessageSquare,
  Clock3,
  PlugZap,
} from "lucide-react";
import { requireRole } from "@/lib/authz";
import { integrationStatus } from "@/lib/services/integration-status";
export const dynamic = "force-dynamic";
const states = {
  "configuration-needed": "Setup required",
  "verification-needed": "Verification required",
  "implementation-needed": "Build required",
};
const icons = {
  checkout: CreditCard,
  tax: Calculator,
  google: KeyRound,
  email: Mail,
  "website-media": Images,
  "operating-media": Images,
  documents: FileLock2,
  maps: MapPin,
  quickbooks: Calculator,
  sms: MessageSquare,
  workers: Clock3,
};
export default async function IntegrationsPage() {
  await requireRole("ADMIN", "SUPER_ADMIN");
  const status = integrationStatus();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-teal-950">Integrations</h1>
          <p className="mt-2 text-teal-800">
            Connections and launch checks for your store.
          </p>
        </div>
        <Link href="/admin/integrations" className="ops-button secondary">
          Refresh status
        </Link>
      </div>
      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
        <p className="font-semibold capitalize">
          {status.environment} · Checkout{" "}
          {status.checkoutEnabled ? "configuration present" : "closed"}
        </p>
        <p className="mt-2 text-sm">
          Configuration checks do not certify a working provider connection. Complete each
          workflow test before launch.
        </p>
        <p className="mt-2 text-sm">
          Checked {status.checkedAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Object.entries(states).map(([key, label]) => (
          <a href={`#${key}`} className="rounded-2xl border bg-white p-5" key={key}>
            <p className="text-sm text-teal-800">{label}</p>
            <strong className="text-3xl">
              {status.connections.filter((c) => c.state === key).length}
            </strong>
          </a>
        ))}
      </div>
      {Object.entries(states).map(([state, label]) => (
        <section id={state} key={state} className="space-y-4">
          <h2 className="text-xl font-semibold">{label}</h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {status.connections
              .filter((c) => c.state === state)
              .map((connection) => {
                const Icon = icons[connection.id as keyof typeof icons] ?? PlugZap;
                return (
                  <article
                    key={connection.id}
                    className="rounded-2xl border bg-white p-5"
                  >
                    <h3 className="flex items-center gap-3 text-lg font-semibold">
                      <Icon size={22} aria-hidden="true" />
                      {connection.name}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-teal-900">
                      {connection.summary}
                    </p>
                    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
                      {connection.nextSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    {connection.action && (
                      <Link
                        href={connection.action.href as Route}
                        className="ops-button secondary mt-4"
                      >
                        {connection.action.label}
                      </Link>
                    )}
                  </article>
                );
              })}
          </div>
          {!status.connections.some((c) => c.state === state) && (
            <p className="text-sm text-teal-800">No connections in this group.</p>
          )}
        </section>
      ))}
      <details className="rounded-2xl border bg-white p-5">
        <summary className="cursor-pointer font-semibold">
          Connection addresses for provider setup
        </summary>
        <p className="mt-3 text-sm">
          Use these exact addresses for this environment. Add secrets securely in hosting
          settings.
        </p>
        <dl className="mt-4 grid gap-3 text-sm">
          <dt className="font-semibold">Google callback</dt>
          <dd className="break-all">
            {status.callbacks.google ?? "Configure a trusted application origin first."}
          </dd>
          <dt className="font-semibold">Stripe webhook</dt>
          <dd className="break-all">
            {status.callbacks.stripeWebhook ??
              "Configure a trusted application origin first."}
          </dd>
        </dl>
      </details>
    </div>
  );
}
