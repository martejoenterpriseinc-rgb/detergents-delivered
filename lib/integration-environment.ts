export type IntegrationEnvironment = "sandbox" | "live";
type Environment = Record<string, string | undefined>;

export const providerFields = {
  stripe: [
    "STRIPE_RESTRICTED_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_ACCOUNT_ID",
  ],
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  email: ["EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM", "EMAIL_ALLOWED_RECIPIENTS"],
} as const;
type Provider = keyof typeof providerFields;

// APP_ENV belongs to the server deployment. Never accept a cookie, request header,
// query parameter, browser setting or job payload as environment authority.
export function integrationEnvironment(
  env: Environment = process.env,
): IntegrationEnvironment | null {
  if (env.APP_ENV === "production") return "live";
  if (env.APP_ENV === "staging" || env.APP_ENV === "development") return "sandbox";
  return null;
}

export function integrationKey(mode: IntegrationEnvironment, field: string) {
  return `DD_${mode.toUpperCase()}_${field}`;
}

export function applicationOrigin(
  value: string | undefined,
  local = false,
): string | null {
  try {
    const url = new URL(value ?? "");
    if (
      (url.protocol !== "https:" &&
        !(
          local &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function environmentProblems(env: Environment = process.env): string[] {
  const mode = integrationEnvironment(env);
  if (!mode) return ["Application environment is not configured."];
  const problems: string[] = [];
  const opposite = mode === "sandbox" ? "live" : "sandbox";
  // Do not even mount the other environment's provider credentials in this service.
  if (
    Object.values(providerFields)
      .flat()
      .some((field) => env[integrationKey(opposite, field)]?.trim())
  )
    problems.push(
      "Remove the other environment's integration credentials from this service.",
    );
  const origins = {
    sandbox: applicationOrigin(env.DD_SANDBOX_APP_URL, env.APP_ENV === "development"),
    live: applicationOrigin(env.DD_LIVE_APP_URL),
  };
  for (const target of ["sandbox", "live"] as const) {
    if (env[`DD_${target.toUpperCase()}_APP_URL`]?.trim() && !origins[target])
      problems.push(`Configure a valid ${target} application address.`);
  }
  const ownOrigin = applicationOrigin(env.AUTH_URL, env.APP_ENV === "development");
  if (origins[mode] && origins[mode] !== ownOrigin)
    problems.push(
      "The active environment address must match this service's authentication origin.",
    );
  if (
    origins[opposite] &&
    (origins[opposite] === ownOrigin || origins[opposite] === origins[mode])
  )
    problems.push("Sandbox and live must use separate application origins.");
  if (
    env.DD_LEGACY_INTEGRATION_ENVIRONMENT &&
    env.DD_LEGACY_INTEGRATION_ENVIRONMENT !== mode
  )
    problems.push("Legacy integration credentials are bound to another environment.");
  return problems;
}

const legacyNames: Record<string, string[]> = {
  STRIPE_ACCOUNT_ID: ["DD_STRIPE_ACCOUNT_ID"],
  GOOGLE_CLIENT_ID: ["GOOGLE_CLIENT_ID", "AUTH_GOOGLE_ID"],
  GOOGLE_CLIENT_SECRET: ["GOOGLE_CLIENT_SECRET", "AUTH_GOOGLE_SECRET"],
  EMAIL_ALLOWED_RECIPIENTS: ["DD_EMAIL_ALLOWED_RECIPIENTS"],
};

// Server-only values. Consumers must construct explicit redacted DTOs.
// A provider uses one complete namespace; partial configuration never mixes
// with legacy names. Legacy hosted keys require an explicit migration binding.
export function providerConfiguration(
  provider: Provider,
  env: Environment = process.env,
) {
  const mode = integrationEnvironment(env);
  const fields = providerFields[provider];
  const values: Record<string, string> = {};
  const invalid = environmentProblems(env).length > 0;
  const namespaced =
    mode && fields.some((field) => Boolean(env[integrationKey(mode, field)]?.trim()));
  const legacy =
    !namespaced &&
    (env.APP_ENV === "development" || env.DD_LEGACY_INTEGRATION_ENVIRONMENT === mode);
  for (const field of fields) {
    values[field] =
      !mode || invalid
        ? ""
        : namespaced
          ? (env[integrationKey(mode, field)]?.trim() ?? "")
          : legacy
            ? ((legacyNames[field] ?? [field])
                .map((name) => env[name]?.trim())
                .find(Boolean) ?? "")
            : "";
  }
  return {
    mode,
    source: invalid ? "blocked" : namespaced ? "separate" : legacy ? "legacy" : "missing",
    values,
  };
}

export function environmentSettings(env: Environment = process.env) {
  const active = integrationEnvironment(env);
  const problems = environmentProblems(env);
  const currentOrigin = applicationOrigin(env.AUTH_URL, env.APP_ENV === "development");
  return {
    active,
    problems,
    environments: (["sandbox", "live"] as const).map((mode) => {
      const current = mode === active;
      const configuredOrigin = applicationOrigin(
        env[`DD_${mode.toUpperCase()}_APP_URL`],
        mode === "sandbox" && env.APP_ENV === "development",
      );
      const origin = problems.length
        ? null
        : (configuredOrigin ?? (current ? currentOrigin : null));
      const serviceId =
        current && /^srv-[a-z0-9]+$/.test(env.RENDER_SERVICE_ID ?? "")
          ? env.RENDER_SERVICE_ID
          : null;
      return {
        mode,
        current,
        origin,
        apiUrl: origin ? `${origin}/api` : null,
        settingsUrl: origin ? `${origin}/admin/settings` : null,
        credentialsUrl: serviceId
          ? `https://dashboard.render.com/web/${serviceId}/env`
          : null,
        callbacks: {
          stripe: origin ? `${origin}/api/stripe/webhook` : null,
          google: origin ? `${origin}/api/auth/callback/google` : null,
        },
        providers: (Object.keys(providerFields) as Provider[]).map((provider) => {
          const config = current ? providerConfiguration(provider, env) : null;
          return {
            id: provider,
            source: config?.source ?? "other-service",
            fields: providerFields[provider].map((field) => ({
              name: integrationKey(mode, field),
              configured: config ? Boolean(config.values[field]) : null,
            })),
          };
        }),
      };
    }),
  };
}
