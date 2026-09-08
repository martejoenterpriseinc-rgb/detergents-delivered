import { describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "./runtime-config";
const valid = {
  APP_ENV: "staging",
  DATABASE_URL: "postgresql://synthetic:synthetic@dd-db/dd_staging",
  DD_DATABASE_HOST: "dd-db",
  DD_DATABASE_NAME: "dd_staging",
  AUTH_SECRET: "synthetic-test-value-for-configuration-only-12345",
  AUTH_URL: "https://dd.example.test",
};
describe("runtime configuration", () => {
  it("accepts a pinned staging target and local development", () => {
    expect(() => validateRuntimeConfig(valid)).not.toThrow();
    expect(() =>
      validateRuntimeConfig({
        ...valid,
        APP_ENV: "development",
        AUTH_URL: "http://127.0.0.1:3000",
      }),
    ).not.toThrow();
  });
  it.each([
    { APP_ENV: undefined },
    { APP_ENV: "stagign" },
    { DATABASE_URL: undefined },
    { DATABASE_URL: "https://bad.example/db" },
    { DATABASE_URL: "postgresql://other/db" },
    { DD_DATABASE_HOST: undefined },
    { DD_DATABASE_NAME: "other" },
    { AUTH_SECRET: "short" },
    { AUTH_SECRET: "ci-only-placeholder-not-a-real-secret" },
    { AUTH_URL: "http://dd.example.test" },
    { AUTH_URL: undefined },
    { AUTH_URL: "https://dd.example.test/path" },
    { NEXTAUTH_URL: "https://other.example.test" },
    { STRIPE_SECRET_KEY: "sk_live_synthetic" },
    { DATABASE_URL: "postgresql://dd-prod/db", DD_DATABASE_HOST: "dd-prod" },
    { APP_ENV: "production", DEMO_MODE: "true" },
  ])("rejects unsafe configuration %j", (overrides) => {
    expect(() => validateRuntimeConfig({ ...valid, ...overrides })).toThrow();
  });
  it("never discloses a rejected connection string", () => {
    expect(() =>
      validateRuntimeConfig({
        ...valid,
        DATABASE_URL: "postgresql://private-user:private-password@wrong/db",
      }),
    ).toThrow("reviewed Detergents Delivered database target");
  });
});
