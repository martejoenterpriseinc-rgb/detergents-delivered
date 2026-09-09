import "@/tests/integration-guard";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  apiEditorData,
  integrationSettingKey,
  readManagedEnvironment,
  saveApiField,
} from "./vault";
import { providerConfiguration } from "@/lib/integration-environment";
import { openIntegration } from "./secrets";
const env = {
  APP_ENV: "development",
  AUTH_URL: "http://localhost:3000",
  DD_CHECKOUT_ENABLED: "false",
  DD_BUSINESS_DOCUMENT_ACTIVE_KEY: "synthetic",
  DD_BUSINESS_DOCUMENT_KEYS: JSON.stringify({ synthetic: "36".repeat(32) }),
  GOOGLE_CLIENT_ID: "legacy.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "legacy-private-google-secret",
};
let ownerId: string;
const keys = [
  "stripe",
  "google",
  "email",
  "sms",
  "quickbooks",
  "storage",
  "destination",
].flatMap((p) => [integrationSettingKey("sandbox", p), integrationSettingKey("live", p)]);
beforeEach(async () => {
  expect(await prisma.setting.count({ where: { key: { in: keys } } })).toBe(0);
  const role = await prisma.role.upsert({
    where: { code: "ADMIN" },
    update: {},
    create: { code: "ADMIN", name: "Admin" },
  });
  ownerId = (
    await prisma.user.create({
      data: {
        email: `api-owner-${randomUUID()}@example.test`,
        userRoles: { create: { roleId: role.id } },
      },
    })
  ).id;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await prisma.setting.deleteMany({ where: { key: { in: keys } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: ownerId } });
  await prisma.user.delete({ where: { id: ownerId } });
});
const input = (value: string, version = 0) => ({
  environment: "sandbox",
  provider: "google",
  field: "GOOGLE_CLIENT_SECRET",
  value,
  version,
});
it("saves one encrypted row, preserves an existing legacy provider group and feeds the runtime without restart", async () => {
  const result = await saveApiField(ownerId, input("new-private-secret"), env);
  const key = integrationSettingKey("sandbox", "google");
  const row = await prisma.setting.findUniqueOrThrow({ where: { key } });
  const logs = await prisma.auditLog.findMany({ where: { actorUserId: ownerId } });
  const serialized = JSON.stringify({ result, row, logs });
  for (const value of [
    "new-private-secret",
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
  ])
    expect(serialized).not.toContain(value);
  const managed = await readManagedEnvironment(["google"], env);
  expect(providerConfiguration("google", managed).values).toEqual({
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "new-private-secret",
  });
  expect(env.GOOGLE_CLIENT_SECRET).toBe("legacy-private-google-secret");
  expect(
    (await apiEditorData(env)).groups
      .find((g) => g.id === "google")
      ?.rows.find((r) => r.key === "GOOGLE_CLIENT_SECRET"),
  ).toMatchObject({ configured: true, source: "saved", version: 1 });
  await saveApiField(ownerId, input("new-private-secret"), env); // Lost-response retry is idempotent.
  expect(await prisma.auditLog.count({ where: { actorUserId: ownerId } })).toBe(1);
});
it("rejects cross-environment writes, unknown fields and revoked admin access", async () => {
  await expect(
    saveApiField(ownerId, { ...input("secret"), environment: "live" }, env),
  ).rejects.toThrow(/other environment/);
  await expect(
    saveApiField(ownerId, { ...input("secret"), field: "AUTH_SECRET" }, env),
  ).rejects.toThrow(/cannot be edited/);
  await prisma.userRole.deleteMany({ where: { userId: ownerId } });
  await expect(saveApiField(ownerId, input("secret"), env)).rejects.toThrow(
    /Administrator/,
  );
  expect(await prisma.setting.count({ where: { key: { in: keys } } })).toBe(0);
});
it("serializes competing saves and preserves the winner after a stale write", async () => {
  const results = await Promise.allSettled([
    saveApiField(ownerId, input("first"), env),
    saveApiField(ownerId, input("second"), env),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const saved = providerConfiguration(
    "google",
    await readManagedEnvironment(["google"], env),
  ).values.GOOGLE_CLIENT_SECRET;
  await expect(saveApiField(ownerId, input("stale"), env)).rejects.toThrow(/another tab/);
  expect(
    providerConfiguration("google", await readManagedEnvironment(["google"], env)).values
      .GOOGLE_CLIENT_SECRET,
  ).toBe(saved);
});
it("keeps saved keys out of the other environment and rejects ciphertext moved across environments", async () => {
  await saveApiField(ownerId, input("sandbox-secret"), env);
  const row = await prisma.setting.findUniqueOrThrow({
    where: { key: integrationSettingKey("sandbox", "google") },
  });
  const liveEnv = {
    ...env,
    APP_ENV: "production",
    AUTH_URL: "https://detergentsdelivered.com",
  };
  expect(
    providerConfiguration("google", await readManagedEnvironment(["google"], liveEnv))
      .values.GOOGLE_CLIENT_SECRET,
  ).toBe("");
  const sealed = row.valueJson as { keyId: string; ciphertext: string; version: number };
  expect(() =>
    openIntegration(
      sealed,
      `${integrationSettingKey("live", "google")}:${sealed.version}`,
      liveEnv,
    ),
  ).toThrow();
});
it("does not let API edits open checkout or change payment credentials while checkout is enabled", async () => {
  const stripe = {
    environment: "sandbox",
    provider: "stripe",
    field: "STRIPE_SECRET_KEY",
    value: "sk_test_synthetic",
    version: 0,
  };
  await expect(
    saveApiField(ownerId, stripe, { ...env, DD_CHECKOUT_ENABLED: "true" }),
  ).rejects.toThrow(/Close checkout/);
  await expect(
    saveApiField(ownerId, { ...stripe, value: "sk_live_wrong" }, env),
  ).rejects.toThrow(/test key/);
  await saveApiField(ownerId, stripe, env);
  expect((await readManagedEnvironment(["stripe"], env)).DD_CHECKOUT_ENABLED).toBe(
    "false",
  );
});
it("saves the other app address only as a navigation destination", async () => {
  await saveApiField(
    ownerId,
    {
      environment: "sandbox",
      provider: "destination",
      field: "APP_URL",
      value: "https://production.example.com",
      version: 0,
    },
    env,
  );
  const dto = await apiEditorData(env);
  expect(dto.targetOrigin).toBe("https://production.example.com");
  expect(dto.active).toBe("sandbox");
  expect((await readManagedEnvironment([], env)).AUTH_URL).toBe("http://localhost:3000");
});

it("rolls back the encrypted replacement if its audit record cannot be written", async () => {
  await saveApiField(ownerId, input("retained-original"), env);
  const original = await prisma.setting.findUniqueOrThrow({
    where: { key: integrationSettingKey("sandbox", "google") },
  });
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION dd_api_audit_test_fail() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.action = ''integration.field.updated'' THEN RAISE EXCEPTION ''synthetic audit failure''; END IF; RETURN NEW; END'`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER dd_api_audit_test BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION dd_api_audit_test_fail()`,
  );
  try {
    await expect(
      saveApiField(ownerId, input("must-not-commit", 1), env),
    ).rejects.toThrow();
    expect(
      await prisma.setting.findUniqueOrThrow({ where: { key: original.key } }),
    ).toEqual(original);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER dd_api_audit_test ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION dd_api_audit_test_fail()`);
  }
});
it("makes saved Google, Stripe and email values available to actual runtime consumers", async () => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("AUTH_SECRET", "synthetic-runtime-secret-not-used-for-api-encryption");
  await saveApiField(ownerId, input("new-google-secret"), env);
  const { runtimeGoogleProviders } = await import("./google");
  expect((await runtimeGoogleProviders())[0].options?.clientSecret).toBe(
    "new-google-secret",
  );
  const stripeEnv = {
    ...env,
    DD_SANDBOX_STRIPE_ACCOUNT_ID: "acct_synthetic",
    DD_SANDBOX_STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
  };
  await saveApiField(
    ownerId,
    {
      environment: "sandbox",
      provider: "stripe",
      field: "STRIPE_SECRET_KEY",
      value: "sk_test_runtime",
      version: 0,
    },
    stripeEnv,
  );
  const { readCommerce } = await import("@/lib/commerce/runtime");
  expect(await readCommerce(true)).toMatchObject({
    key: "sk_test_runtime",
    accountId: "acct_synthetic",
    live: false,
    webhookSecret: "whsec_synthetic",
  });
  const emailEnv = {
    ...env,
    EMAIL_PROVIDER: "sendgrid",
    EMAIL_FROM: "sender@example.test",
    DD_EMAIL_ALLOWED_RECIPIENTS: "approved@example.test",
  };
  await saveApiField(
    ownerId,
    {
      environment: "sandbox",
      provider: "email",
      field: "EMAIL_API_KEY",
      value: "synthetic-email-key",
      version: 0,
    },
    emailEnv,
  );
  const { runtimeRecoveryEmailConfiguration } =
    await import("@/lib/services/password-recovery");
  expect(await runtimeRecoveryEmailConfiguration()).toMatchObject({
    apiKey: "synthetic-email-key",
    allowed: ["approved@example.test"],
    from: { email: "sender@example.test" },
  });
});
