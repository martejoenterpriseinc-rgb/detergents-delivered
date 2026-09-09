import { afterEach, describe, expect, it, vi } from "vitest";
const adapters = vi.hoisted(() => ({ email: vi.fn(), documents: vi.fn() }));
vi.mock("./password-recovery", () => ({ recoveryEmailConfiguration: adapters.email }));
vi.mock("@/lib/business/document-security", () => ({
  documentReadiness: adapters.documents,
}));
import { integrationStatus } from "./integration-status";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
function staging() {
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("DD_LEGACY_INTEGRATION_ENVIRONMENT", "sandbox");
  vi.stubEnv("AUTH_URL", "https://store.example.test");
  vi.stubEnv("DD_CHECKOUT_ENABLED", "true");
  vi.stubEnv("STRIPE_RESTRICTED_KEY", "rk_test_synthetic-private-key");
  vi.stubEnv("DD_STRIPE_ACCOUNT_ID", "acct_synthetic");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_synthetic-private-value");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-google-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-google-secret");
  adapters.email.mockReturnValue({
    apiKey: "synthetic-mail-key",
    allowed: ["private@example.test"],
  });
  adapters.documents.mockReturnValue({ encryption: true, scannerConfigured: true });
}
describe("integration configuration status (provider calls are not performed)", () => {
  it("never treats credentials as provider acceptance or serializes secrets", () => {
    staging();
    const status = integrationStatus();
    expect(status.checkoutEnabled).toBe(true);
    expect(status.connections.find((c) => c.id === "google")?.state).toBe(
      "verification-needed",
    );
    expect(status.connections.find((c) => c.id === "workers")?.state).toBe(
      "verification-needed",
    );
    expect(status.connections.find((c) => c.id === "quickbooks")?.state).toBe(
      "implementation-needed",
    );
    expect(status.callbacks.google).toBe(
      "https://store.example.test/api/auth/callback/google",
    );
    const serialized = JSON.stringify(status);
    for (const secret of [
      "rk_test_synthetic-private-key",
      "acct_synthetic",
      "whsec_synthetic-private-value",
      "synthetic-google-client",
      "synthetic-google-secret",
      "synthetic-mail-key",
      "private@example.test",
    ])
      expect(serialized).not.toContain(secret);
  });
  it("reports incomplete providers, wrong Stripe mode and unsafe origins without reflecting them", () => {
    staging();
    vi.stubEnv("STRIPE_RESTRICTED_KEY", "rk_live_synthetic");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "");
    vi.stubEnv("AUTH_URL", "https://private:password@store.example.test/path?secret=yes");
    adapters.email.mockImplementation(() => {
      throw new Error("private provider detail");
    });
    adapters.documents.mockReturnValue({ encryption: false, scannerConfigured: false });
    const status = integrationStatus();
    expect(status.checkoutEnabled).toBe(false);
    for (const id of ["checkout", "google", "email", "documents"])
      expect(status.connections.find((c) => c.id === id)?.state).toBe(
        "configuration-needed",
      );
    expect(status.callbacks).toEqual({ google: null, stripeWebhook: null });
    expect(JSON.stringify(status)).not.toMatch(
      /private:password|secret=yes|private provider detail/,
    );
  });
});
