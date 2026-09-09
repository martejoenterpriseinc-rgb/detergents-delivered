import { environmentProblems } from "./integration-environment";

type Environment = Record<string, string | undefined>;

// Messages name configuration keys only. Never interpolate URLs or secret values.
export function validateRuntimeConfig(env: Environment): void {
  if (!["development", "staging", "production"].includes(env.APP_ENV ?? "")) {
    throw new Error(
      "APP_ENV must be explicitly set to development, staging, or production.",
    );
  }
  const integrationProblems = environmentProblems(env);
  if (integrationProblems.length) throw new Error(integrationProblems.join(" "));
  let database: URL;
  try {
    database = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error(
      "DATABASE_URL is missing or invalid; set it securely on the app service.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !database.hostname ||
    database.pathname.length < 2
  ) {
    throw new Error("DATABASE_URL must identify a PostgreSQL host and database.");
  }
  if (
    env.APP_ENV !== "production" &&
    [database.hostname, decodeURIComponent(database.pathname.slice(1))].some((part) =>
      /(^|[_.-])prod(uction)?([_.-]|$)/i.test(part),
    )
  ) {
    throw new Error("A non-production app cannot use a production database target.");
  }
  if (env.APP_ENV !== "development") {
    if (!env.DD_DATABASE_HOST || !env.DD_DATABASE_NAME) {
      throw new Error(
        "DD_DATABASE_HOST and DD_DATABASE_NAME must pin the reviewed database target.",
      );
    }
    if (
      database.hostname !== env.DD_DATABASE_HOST ||
      decodeURIComponent(database.pathname.slice(1)) !== env.DD_DATABASE_NAME
    ) {
      throw new Error(
        "DATABASE_URL does not match the reviewed Detergents Delivered database target.",
      );
    }
  }
  if (
    !env.AUTH_SECRET ||
    env.AUTH_SECRET.length < 32 ||
    /placeholder|change.?me/i.test(env.AUTH_SECRET)
  ) {
    throw new Error(
      "AUTH_SECRET must be a unique securely generated value of at least 32 characters.",
    );
  }
  let origin: URL;
  try {
    origin = new URL(env.AUTH_URL ?? "");
  } catch {
    throw new Error("AUTH_URL must be explicitly set to the application origin.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    (origin.protocol !== "https:" &&
      !(env.APP_ENV === "development" && local && origin.protocol === "http:")) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new Error(
      "AUTH_URL must be an HTTPS origin (HTTP loopback is allowed for development only).",
    );
  }
  if (env.NEXTAUTH_URL && env.NEXTAUTH_URL.replace(/\/$/, "") !== origin.origin) {
    throw new Error("NEXTAUTH_URL and AUTH_URL must identify the same origin.");
  }
  if (
    env.APP_ENV !== "production" &&
    Object.entries(env).some(
      ([key, value]) => /STRIPE.*KEY/.test(key) && /^(sk|rk|pk)_live_/.test(value ?? ""),
    )
  ) {
    throw new Error("Live Stripe keys are not permitted in development or staging.");
  }
  if (
    env.APP_ENV === "production" &&
    [
      env.DEMO_MODE,
      env.SEED_DEMO_CATALOG,
      env.SEED_BOOTSTRAP_ADMIN,
      env.DD_ALLOW_DATABASE_TESTS,
      env.DD_SYNTHETIC_PREVIEW,
      env.DD_LOCAL_PROOF_STORAGE,
      env.DD_LOCAL_CATALOG_STORAGE,
    ].includes("true")
  ) {
    throw new Error("Demo and bootstrap flags must be disabled in production.");
  }
  if (
    env.APP_ENV === "production" &&
    [
      database.hostname,
      decodeURIComponent(database.pathname.slice(1)),
      origin.hostname,
    ].some((part) =>
      /(^|[_.-])(staging|sandbox|test|ci|development|dev|localhost)([_.-]|$)/i.test(part),
    )
  ) {
    throw new Error("Production cannot use a development, staging or sandbox target.");
  }
  if (
    env.APP_ENV === "production" &&
    Object.entries(env).some(
      ([key, value]) => /STRIPE.*KEY/.test(key) && /^(sk|rk|pk)_test_/.test(value ?? ""),
    )
  ) {
    throw new Error("Sandbox Stripe keys belong in the isolated sandbox service.");
  }
}
