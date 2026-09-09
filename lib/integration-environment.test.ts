import { afterEach, describe, expect, it, vi } from "vitest";
import {
  environmentProblems,
  environmentSettings,
  integrationEnvironment,
  providerConfiguration,
} from "./integration-environment";
import { commerceConfiguration } from "./commerce/config";
import { googleSignInCredentials } from "./domain/customer-access";
import { validateRuntimeConfig } from "./runtime-config";

const sandbox = {
  APP_ENV: "staging",
  AUTH_URL: "https://sandbox.example.com",
  DD_SANDBOX_APP_URL: "https://sandbox.example.com",
  DD_LIVE_APP_URL: "https://shop.example.com",
  DD_CHECKOUT_ENABLED: "true",
  DD_SANDBOX_STRIPE_RESTRICTED_KEY: "rk_test_synthetic",
  DD_SANDBOX_STRIPE_ACCOUNT_ID: "acct_synthetic",
  DD_SANDBOX_STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
};
afterEach(() => vi.unstubAllEnvs());

describe("server environment isolation", () => {
  it("selects the sandbox key, account and webhook as one configuration", () => {
    expect(commerceConfiguration(sandbox)).toMatchObject({
      enabled: true,
      live: false,
      key: "rk_test_synthetic",
      accountId: "acct_synthetic",
      webhookSecret: "whsec_synthetic",
      origin: "https://sandbox.example.com",
    });
  });
  it("selects a separately configured live provider only on a production service", () => {
    const config = commerceConfiguration({
      APP_ENV: "production",
      AUTH_URL: "https://shop.example.com",
      DD_LIVE_APP_URL: "https://shop.example.com",
      DD_SANDBOX_APP_URL: "https://sandbox.example.com",
      DD_LIVE_STRIPE_SECRET_KEY: "sk_live_synthetic",
      DD_LIVE_STRIPE_ACCOUNT_ID: "acct_liveidentity",
      DD_LIVE_STRIPE_WEBHOOK_SECRET: "whsec_liveidentity",
      DD_CHECKOUT_ENABLED: "true",
      DD_LIVE_CHECKOUT_ACCEPTED: "true",
    });
    expect(config).toMatchObject({
      enabled: true,
      live: true,
      key: "sk_live_synthetic",
      webhookSecret: "whsec_liveidentity",
      accountId: "acct_liveidentity",
    });
  });
  it.each([undefined, "", "sandbox", "prod", "stagign"])(
    "does not default unknown APP_ENV %s to a working provider",
    (APP_ENV) => {
      expect(integrationEnvironment({ APP_ENV })).toBeNull();
      expect(commerceConfiguration({ ...sandbox, APP_ENV }).enabled).toBe(false);
      expect(
        googleSignInCredentials({
          APP_ENV,
          GOOGLE_CLIENT_ID: "client",
          GOOGLE_CLIENT_SECRET: "secret",
        }),
      ).toEqual({ clientId: "", clientSecret: "" });
    },
  );
  it.each([
    "DD_LIVE_STRIPE_SECRET_KEY",
    "DD_LIVE_GOOGLE_CLIENT_SECRET",
    "DD_LIVE_EMAIL_API_KEY",
  ])("blocks opposite credentials %s instead of using them", (field) => {
    const env = { ...sandbox, [field]: "private-value" };
    expect(commerceConfiguration(env).enabled).toBe(false);
    expect(providerConfiguration("stripe", env).values.STRIPE_RESTRICTED_KEY).toBe("");
    expect(() => validateRuntimeConfig(env)).toThrow("other environment");
    expect(JSON.stringify(environmentSettings(env))).not.toContain("private-value");
  });
  it("blocks sandbox credentials mounted in the live service", () => {
    expect(
      environmentProblems({ APP_ENV: "production", DD_SANDBOX_EMAIL_API_KEY: "private" }),
    ).toContain(
      "Remove the other environment's integration credentials from this service.",
    );
  });
  it("rejects a live Stripe key in the sandbox namespace", () => {
    expect(
      commerceConfiguration({
        ...sandbox,
        DD_SANDBOX_STRIPE_RESTRICTED_KEY: "rk_live_synthetic",
      }).enabled,
    ).toBe(false);
  });
  it("never combines partial separate configuration with legacy credentials", () => {
    const env = {
      ...sandbox,
      DD_LEGACY_INTEGRATION_ENVIRONMENT: "sandbox",
      DD_SANDBOX_STRIPE_WEBHOOK_SECRET: "",
      STRIPE_WEBHOOK_SECRET: "whsec_old",
      DD_STRIPE_ACCOUNT_ID: "acct_old",
    };
    const config = commerceConfiguration(env);
    expect(config.enabled).toBe(false);
    expect(config.webhookSecret).toBe("");
    expect(config.accountId).toBe("acct_synthetic");
  });
  it("requires explicit same-environment binding to migrate hosted legacy keys", () => {
    const env = {
      APP_ENV: "staging",
      GOOGLE_CLIENT_ID: "old-client",
      GOOGLE_CLIENT_SECRET: "old-secret",
    };
    expect(googleSignInCredentials(env).clientId).toBe("");
    expect(
      googleSignInCredentials({ ...env, DD_LEGACY_INTEGRATION_ENVIRONMENT: "sandbox" })
        .clientId,
    ).toBe("old-client");
    expect(
      googleSignInCredentials({ ...env, DD_LEGACY_INTEGRATION_ENVIRONMENT: "live" })
        .clientId,
    ).toBe("");
  });
  it("selects Google and email using the same environment, preserving the test recipient restriction", () => {
    const env = {
      ...sandbox,
      DD_SANDBOX_GOOGLE_CLIENT_ID: "sandbox-client",
      DD_SANDBOX_GOOGLE_CLIENT_SECRET: "sandbox-secret",
      DD_SANDBOX_EMAIL_API_KEY: "sandbox-mail",
      DD_SANDBOX_EMAIL_ALLOWED_RECIPIENTS: "approved@example.test",
      EMAIL_API_KEY: "unused-legacy-mail",
    };
    expect(googleSignInCredentials(env)).toEqual({
      clientId: "sandbox-client",
      clientSecret: "sandbox-secret",
    });
    expect(providerConfiguration("email", env).values).toMatchObject({
      EMAIL_API_KEY: "sandbox-mail",
      EMAIL_ALLOWED_RECIPIENTS: "approved@example.test",
    });
  });
  it.each([
    { DD_LIVE_APP_URL: "https://sandbox.example.com" },
    { DD_SANDBOX_APP_URL: "https://wrong.example.com" },
    { DD_LIVE_APP_URL: "https://user:private@example.com/path?token=secret" },
    { DD_LIVE_APP_URL: "javascript:alert(1)" },
    { DD_LIVE_APP_URL: "http://localhost:3000" },
  ])("blocks mismatched or unsafe environment origins %j", (overrides) => {
    const env = { ...sandbox, ...overrides };
    expect(commerceConfiguration(env).enabled).toBe(false);
    expect(
      environmentSettings(env).environments.every((item) => item.settingsUrl === null),
    ).toBe(true);
    expect(JSON.stringify(environmentSettings(env))).not.toMatch(
      /user:private|token=secret|javascript:/,
    );
  });
  it("exposes only current configuration presence and trusted destinations, never secrets or remote readiness claims", () => {
    const settings = environmentSettings({
      ...sandbox,
      RENDER_SERVICE_ID: "srv-synthetic",
      DD_SANDBOX_GOOGLE_CLIENT_SECRET: "google-private",
      DD_SANDBOX_EMAIL_API_KEY: "mail-private",
    });
    expect(settings.environments[0]).toMatchObject({
      current: true,
      apiUrl: "https://sandbox.example.com/api",
      credentialsUrl: "https://dashboard.render.com/web/srv-synthetic/env",
    });
    expect(settings.environments[1]).toMatchObject({
      current: false,
      settingsUrl: "https://shop.example.com/admin/settings",
      credentialsUrl: null,
    });
    expect(
      settings.environments[1].providers.every((p) =>
        p.fields.every((f) => f.configured === null),
      ),
    ).toBe(true);
    for (const secret of [
      "rk_test_synthetic",
      "acct_synthetic",
      "whsec_synthetic",
      "google-private",
      "mail-private",
    ])
      expect(JSON.stringify(settings)).not.toContain(secret);
  });
  it("keeps the live switch disabled when the live service is absent", () => {
    const settings = environmentSettings({
      APP_ENV: "staging",
      AUTH_URL: "https://sandbox.example.com",
    });
    expect(settings.environments[1].settingsUrl).toBeNull();
    expect(settings.environments[0].apiUrl).toBe("https://sandbox.example.com/api");
  });
});
