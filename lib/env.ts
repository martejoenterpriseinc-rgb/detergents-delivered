export type AppEnv = "development" | "staging" | "production";

export function getAppEnv(): AppEnv {
  const value = process.env.APP_ENV ?? "development";
  if (value === "development" || value === "staging" || value === "production") {
    return value;
  }
  return "development";
}

export function isDevelopment() {
  return getAppEnv() === "development";
}

export function isProduction() {
  return getAppEnv() === "production";
}

export function assertNonProductionDatabase(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    return;
  }
  if (isDevelopment() && /prod|production/i.test(databaseUrl)) {
    throw new Error(
      "Refusing to use a production-looking DATABASE_URL while APP_ENV=development.",
    );
  }
}
