import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import {
  applicationOrigin,
  environmentProblems,
  integrationEnvironment,
  integrationKey,
  providerConfiguration,
  providerFields,
  type IntegrationEnvironment,
} from "@/lib/integration-environment";
import { integrationCatalog, type ApiEditorData, type ManagedProvider } from "./catalog";
import { canSealIntegrations, openIntegration, sealIntegration } from "./secrets";
import { updateApiSchema, validateApiValue } from "./validation";

type Env = Record<string, string | undefined>;
const envelopeSchema = z
  .object({
    version: z.number().int().positive(),
    keyId: z.string(),
    ciphertext: z.string(),
  })
  .strict();
const payloadSchema = z
  .object({
    values: z.record(z.string(), z.string()),
    changedAt: z.record(z.string(), z.string()),
  })
  .strict();
export const integrationSettingKey = (mode: IntegrationEnvironment, provider: string) =>
  `integrations:v1:${mode}:${provider}`;
function decode(raw: unknown, key: string, env: Env) {
  const envelope = envelopeSchema.parse(raw);
  return {
    version: envelope.version,
    ...payloadSchema.parse(openIntegration(envelope, `${key}:${envelope.version}`, env)),
  };
}
function authority(env: Env) {
  const mode = integrationEnvironment(env);
  if (!mode || environmentProblems(env).length)
    throw new AccountError(
      "Fix the service environment configuration before updating APIs.",
      503,
    );
  return mode;
}

// Every worker/request reads the same committed provider snapshot. No process.env
// mutation, browser-selected environment, cross-environment fallback or stale cache.
export async function readManagedEnvironment(
  providers: readonly ManagedProvider[] = integrationCatalog.map((p) => p.id),
  env: Env = process.env,
): Promise<Env> {
  const mode = authority(env);
  const keys = providers.map((p) => integrationSettingKey(mode, p));
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const result = { ...env };
  for (const row of rows) {
    const provider = providers.find((p) => integrationSettingKey(mode, p) === row.key)!;
    const payload = decode(row.valueJson, row.key, env);
    // A managed group replaces the whole provider namespace, including blanks.
    // Initial saving snapshots any already-bound legacy group atomically.
    for (const field of providerFields[provider])
      result[integrationKey(mode, field)] = payload.values[field] ?? "";
  }
  return result;
}

export async function apiEditorData(env: Env = process.env): Promise<ApiEditorData> {
  const mode = integrationEnvironment(env);
  const problems = environmentProblems(env);
  const origin = applicationOrigin(env.AUTH_URL, env.APP_ENV === "development");
  const groups: ApiEditorData["groups"] = [];
  const canSave = canSealIntegrations(env);
  if (!canSave)
    problems.push(
      "Secure API saving needs a retained encryption key in hosting settings.",
    );
  let destinationVersion = 0;
  let targetOrigin: string | null = null;
  if (mode) {
    const opposite = mode === "sandbox" ? "live" : "sandbox";
    targetOrigin = applicationOrigin(env[`DD_${opposite.toUpperCase()}_APP_URL`]);
    const rows = await prisma.setting.findMany({
      where: {
        key: {
          in: [
            ...integrationCatalog.map((p) => integrationSettingKey(mode, p.id)),
            integrationSettingKey(mode, "destination"),
          ],
        },
      },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const provider of integrationCatalog) {
      const key = integrationSettingKey(mode, provider.id);
      const saved = byKey.get(key);
      const payload = saved ? decode(saved.valueJson, key, env) : null;
      const config = providerConfiguration(provider.id, env);
      groups.push({
        ...provider,
        rows: provider.fields.map((field) => {
          const configured = Boolean(
            payload ? payload.values[field.key] : config.values[field.key],
          );
          return {
            ...field,
            configured,
            version: payload?.version ?? 0,
            updatedAt: payload?.changedAt[field.key] ?? null,
            source: configured ? (payload ? "saved" : "hosting") : "missing",
          };
        }),
      });
    }
    const destinationKey = integrationSettingKey(mode, "destination");
    const destination = byKey.get(destinationKey);
    if (destination) {
      const payload = decode(destination.valueJson, destinationKey, env);
      targetOrigin = applicationOrigin(payload.values.APP_URL);
      destinationVersion = payload.version;
    }
    if (targetOrigin === origin) {
      targetOrigin = null;
      problems.push("The other environment must use a separate address.");
    }
  }
  return {
    active: mode,
    origin,
    targetOrigin,
    destinationVersion,
    canSave: canSave && !environmentProblems(env).length,
    problems,
    groups,
  };
}

export async function saveApiField(
  actorUserId: string,
  input: unknown,
  env: Env = process.env,
) {
  const data = updateApiSchema.parse(input);
  const mode = authority(env);
  if (data.environment !== mode)
    throw new AccountError("Open the other environment to edit its API settings.", 409);
  const fields: readonly string[] =
    data.provider === "destination" ? ["APP_URL"] : providerFields[data.provider];
  if (!fields.includes(data.field))
    throw new AccountError("This API field cannot be edited.");
  const value = validateApiValue(
    data.field,
    data.value,
    mode,
    applicationOrigin(env.AUTH_URL, env.APP_ENV === "development"),
  );
  if (!canSealIntegrations(env))
    throw new AccountError(
      "Secure saving is unavailable until the hosting encryption key is configured.",
      503,
    );
  if (data.provider === "stripe" && env.DD_CHECKOUT_ENABLED === "true")
    throw new AccountError(
      "Close checkout before changing payment credentials. Existing payments must finish first.",
      409,
    );
  const key = integrationSettingKey(mode, data.provider);
  await prisma.$transaction(async (tx) => {
    // Lock the stable key, including its first insertion, to prevent lost updates.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const user = await tx.user.findFirst({
      where: {
        id: actorUserId,
        deletedAt: null,
        mustChangeCredentials: false,
        userRoles: { some: { role: { code: { in: ["ADMIN", "SUPER_ADMIN"] } } } },
      },
      select: { id: true },
    });
    if (!user) throw new AccountError("Administrator access is required.", 403);
    if (
      data.provider === "stripe" &&
      (await tx.checkoutAttempt.count({
        where: { state: { in: ["PREPARING", "OPEN", "PROCESSING", "REVIEW"] } },
      }))
    )
      throw new AccountError(
        "Payment recovery is still pending. Finish it before changing Stripe configuration.",
        409,
      );
    const row = await tx.setting.findUnique({ where: { key } });
    const previous = row
      ? decode(row.valueJson, key, env)
      : {
          version: 0,
          values:
            data.provider === "destination"
              ? {}
              : providerConfiguration(data.provider, env).values,
          changedAt: {} as Record<string, string>,
        };
    if (previous.version !== data.version) {
      if (previous.values[data.field] === value) return; // Safe retry after a lost response.
      throw new AccountError(
        "This API changed in another tab. Refresh status, then edit the row again.",
        409,
      );
    }
    if (
      data.provider === "stripe" &&
      data.field === "STRIPE_ACCOUNT_ID" &&
      (await tx.checkoutAttempt.count({ where: { stripeAccountId: { not: value } } }))
    ) {
      throw new AccountError(
        "Existing checkouts belong to another Stripe account. Keep that account connected for payment history and recovery.",
        409,
      );
    }
    const version = previous.version + 1;
    const payload = {
      values: { ...previous.values, [data.field]: value },
      changedAt: { ...previous.changedAt, [data.field]: new Date().toISOString() },
    };
    const sealed = sealIntegration(payload, `${key}:${version}`, env);
    await tx.setting.upsert({
      where: { key },
      create: { key, valueJson: { version, ...sealed } },
      update: { valueJson: { version, ...sealed } },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "integration.field.updated",
        entityType: "Integration",
        entityId: key,
        afterJson: {
          environment: mode,
          provider: data.provider,
          field: data.field,
          configured: true,
          version,
        },
      },
    });
  });
  return apiEditorData(env);
}
