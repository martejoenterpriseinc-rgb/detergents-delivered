import { environmentSettings } from "@/lib/integration-environment";

const names = {
  stripe: "Stripe payments & tax",
  google: "Google sign-in",
  email: "Recovery email",
};

export function EnvironmentSettings() {
  const settings = environmentSettings();
  return (
    <section className="space-y-4" aria-labelledby="environment-heading">
      <div>
        <h2 id="environment-heading" className="text-xl font-semibold">
          Sandbox & live APIs
        </h2>
        <p className="mt-2 text-sm text-teal-800">
          Each environment has its own connections and records. Switching opens that
          environment; you may need to sign in again.
        </p>
      </div>
      {settings.problems.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900"
        >
          {settings.problems.join(" ")}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {settings.environments.map((environment) => (
          <article
            key={environment.mode}
            className={`min-w-0 rounded-2xl border p-5 ${environment.mode === "sandbox" ? "border-red-200 bg-red-50/40" : "border-teal-200 bg-white"}`}
          >
            <h3 className="flex flex-wrap items-center gap-3 text-lg font-semibold capitalize">
              {environment.mode}
              {environment.current && (
                <span className="rounded-full bg-teal-900 px-3 py-1 text-xs text-white">
                  Currently using
                </span>
              )}
            </h3>
            <p className="mt-2 text-sm">
              {environment.mode === "sandbox"
                ? "Test payments and approved test recipients only."
                : "Real customers, orders and payments."}
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <dt className="font-semibold">API address</dt>
              <dd className="break-all">{environment.apiUrl ?? "Not connected"}</dd>
              <dt className="font-semibold">Stripe webhook</dt>
              <dd className="break-all">
                {environment.callbacks.stripe ?? "Available after connection"}
              </dd>
              <dt className="font-semibold">Google callback</dt>
              <dd className="break-all">
                {environment.callbacks.google ?? "Available after connection"}
              </dd>
            </dl>
            <div className="mt-4 flex flex-wrap gap-3">
              {!environment.current &&
                (environment.settingsUrl ? (
                  <a
                    href={environment.settingsUrl}
                    className="ops-button secondary"
                    referrerPolicy="no-referrer"
                  >
                    Switch to {environment.mode}
                  </a>
                ) : (
                  <button disabled className="ops-button secondary opacity-60">
                    {environment.mode === "live" ? "Live" : "Sandbox"} not connected
                  </button>
                ))}
              {environment.credentialsUrl && (
                <a
                  href={environment.credentialsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ops-button secondary"
                >
                  Manage {environment.mode} API keys
                </a>
              )}
            </div>
            <p className="mt-4 text-sm text-teal-800">
              {environment.current
                ? "Secret keys are saved securely in this environment’s hosting settings. Configuration still requires a provider workflow test."
                : "Open this environment to inspect and manage its credentials."}
            </p>
            <details className="mt-4 rounded-xl border bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                API configuration details
              </summary>
              {environment.providers.map((provider) => (
                <div key={provider.id} className="mt-4">
                  <h4 className="text-sm font-semibold">{names[provider.id]}</h4>
                  {provider.source === "legacy" && (
                    <p className="mt-1 text-xs text-amber-900">
                      Using credentials bound to this environment. Replace the complete
                      provider group with the separate names below.
                    </p>
                  )}
                  <ul className="mt-2 space-y-2 text-xs">
                    {provider.fields.map((field) => (
                      <li
                        key={field.name}
                        className="flex flex-wrap justify-between gap-2"
                      >
                        <span className="font-mono break-all">{field.name}</span>
                        <span>
                          {field.configured === null
                            ? "Separate service"
                            : field.configured
                              ? provider.source === "legacy"
                                ? "Legacy configured"
                                : "Configured"
                              : "Not configured"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
