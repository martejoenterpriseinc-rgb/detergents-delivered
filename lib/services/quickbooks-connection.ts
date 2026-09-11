import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { financeAccess } from "./finance";
import { accountIdentity } from "./customer-account";
import { sealIntegration, openIntegration } from "@/lib/integrations/secrets";
import { integrationEnvironment } from "@/lib/integration-environment";
import {
  quickbooksConfig,
  quickbooksAuthorizationUrl,
  exchangeQuickbooksToken,
  revokeQuickbooksToken,
  quickbooksTokenSchema,
  verifyQuickbooksCompany,
} from "@/lib/integrations/quickbooks-client";

const connectionSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum([
    "CONNECTED",
    "REFRESHING",
    "RECONNECT",
    "DISCONNECTING",
    "DISCONNECTED",
  ]),
  fingerprint: z.string(),
  realm: z.string(),
  companyName: z.string(),
  expiresAt: z.string().datetime(),
  changedAt: z.string().datetime(),
  secret: z.object({ keyId: z.string(), ciphertext: z.string() }).nullable(),
});
const stateSchema = z.object({
  actor: z.string(),
  sessionVersion: z.number().int(),
  fingerprint: z.string(),
  realm: z.string(),
  connectionVersion: z.number().int(),
  expiresAt: z.string().datetime(),
  used: z.boolean(),
});
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const connectionKey = () => {
  const mode = integrationEnvironment();
  if (!mode) throw new AccountError("Application environment is unavailable.", 503);
  return "quickbooks:connection:v1:" + mode;
};
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
async function saved(tx: Prisma.TransactionClient, key: string) {
  const row = await tx.setting.findUnique({ where: { key } });
  return row ? connectionSchema.parse(row.valueJson) : null;
}
async function lock(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
}
async function audit(
  tx: Prisma.TransactionClient,
  actor: string,
  action: string,
  key: string,
  realm: string,
) {
  await tx.auditLog.create({
    data: {
      actorUserId: actor,
      action,
      entityType: "QuickBooksConnection",
      entityId: key,
      afterJson: { realm },
    },
  });
}
export async function quickbooksConnectionStatus(actor: string) {
  const canWrite = await financeAccess(prisma, actor);
  const row = await saved(prisma, connectionKey());
  let configured = false,
    matches = false,
    realm: string | null = null;
  try {
    const config = await quickbooksConfig();
    configured = true;
    realm = config.realm;
    matches = row?.fingerprint === config.fingerprint;
  } catch {}
  return {
    canWrite,
    configured,
    realm,
    status: row?.status ?? "NOT_CONNECTED",
    matches,
    expiresAt: row?.expiresAt ?? null,
    usable: Boolean(
      row?.status === "CONNECTED" && matches && new Date(row.expiresAt) > new Date(),
    ),
    postingEnabled: false,
    companyName: row?.companyName ?? null,
  };
}
// Server-only capability snapshot. Never serialize this object into an API response.
export async function authorizedQuickbooks(actor: string) {
  await financeAccess(prisma, actor);
  const config = await quickbooksConfig(),
    key = connectionKey(),
    row = await saved(prisma, key);
  if (
    !row ||
    row.status !== "CONNECTED" ||
    !row.secret ||
    row.fingerprint !== config.fingerprint ||
    new Date(row.expiresAt).getTime() <= Date.now() + 10000
  )
    throw new AccountError(
      "An administrator must connect or refresh QuickBooks first.",
      409,
    );
  const token = quickbooksTokenSchema.parse(
    openIntegration(row.secret, key + ":" + row.version),
  );
  return { config, key, version: row.version, accessToken: token.access_token };
}
export async function assertQuickbooksSnapshot(
  tx: Prisma.TransactionClient,
  actor: string,
  snapshot: Awaited<ReturnType<typeof authorizedQuickbooks>>,
  write = false,
) {
  await lock(tx, snapshot.key);
  await financeAccess(tx, actor, write);
  const current = await saved(tx, snapshot.key);
  if (
    !current ||
    current.version !== snapshot.version ||
    current.status !== "CONNECTED" ||
    current.fingerprint !== snapshot.config.fingerprint ||
    new Date(current.expiresAt) <= new Date()
  )
    throw new AccountError("QuickBooks connection changed. Refresh before saving.", 409);
}
export async function beginQuickbooksConnection(actor: string) {
  await financeAccess(prisma, actor, true);
  const config = await quickbooksConfig(),
    key = connectionKey(),
    state = randomBytes(32).toString("hex");
  await prisma.$transaction(async (tx) => {
    await lock(tx, key);
    await financeAccess(tx, actor, true);
    const user = await accountIdentity(tx, actor);
    const current = await saved(tx, key);
    if (current?.status === "DISCONNECTING")
      throw new AccountError("Finish disconnecting the previous connection first.", 409);
    if (
      (await tx.auditLog.count({
        where: {
          actorUserId: actor,
          action: "quickbooks.authorization.started",
          createdAt: { gte: new Date(Date.now() - 3600000) },
        },
      })) >= 6
    )
      throw new AccountError("Too many connection attempts. Try again in an hour.", 429);
    await tx.setting.create({
      data: {
        key: "quickbooks:oauth:v1:" + hash(state),
        valueJson: json({
          actor,
          sessionVersion: user.sessionVersion,
          fingerprint: config.fingerprint,
          realm: config.realm,
          connectionVersion: current?.version ?? 0,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          used: false,
        }),
      },
    });
    await audit(tx, actor, "quickbooks.authorization.started", key, config.realm);
  });
  return { authorizationUrl: quickbooksAuthorizationUrl(config, state) };
}
export async function completeQuickbooksConnection(actor: string, raw: unknown) {
  const input = z
    .object({
      state: z.string().regex(/^[a-f0-9]{64}$/),
      code: z.string().min(1).max(4000),
      realmId: z.string().regex(/^\d{1,30}$/),
    })
    .strict()
    .parse(raw);
  const config = await quickbooksConfig(),
    key = connectionKey(),
    stateKey = "quickbooks:oauth:v1:" + hash(input.state);
  const claimed = await prisma.$transaction(async (tx) => {
    await lock(tx, key);
    await financeAccess(tx, actor, true);
    const user = await accountIdentity(tx, actor);
    const row = await tx.setting.findUnique({ where: { key: stateKey } });
    if (!row) throw new AccountError("Connection request expired. Start again.", 409);
    const state = stateSchema.parse(row.valueJson),
      current = await saved(tx, key);
    if (
      state.actor !== actor ||
      state.sessionVersion !== user.sessionVersion ||
      state.used ||
      new Date(state.expiresAt) <= new Date() ||
      state.fingerprint !== config.fingerprint ||
      state.realm !== input.realmId ||
      input.realmId !== config.realm ||
      state.connectionVersion !== (current?.version ?? 0)
    )
      throw new AccountError(
        "Connection request changed or expired, or the selected company does not match. Start again.",
        409,
      );
    await tx.setting.update({
      where: { key: stateKey },
      data: { valueJson: json({ ...state, used: true }) },
    });
    await audit(tx, actor, "quickbooks.authorization.claimed", key, config.realm);
    return state;
  });
  const token = await exchangeQuickbooksToken(config, { code: input.code });
  const companyName = await verifyQuickbooksCompany(config, token.access_token);
  if ((await quickbooksConfig()).fingerprint !== config.fingerprint)
    throw new AccountError("QuickBooks settings changed. Start again.", 409);
  await prisma.$transaction(async (tx) => {
    await lock(tx, key);
    await financeAccess(tx, actor, true);
    const user = await accountIdentity(tx, actor),
      current = await saved(tx, key);
    if (
      user.sessionVersion !== claimed.sessionVersion ||
      (current?.version ?? 0) !== claimed.connectionVersion
    )
      throw new AccountError("Connection changed. Start again.", 409);
    const version = claimed.connectionVersion + 1;
    const value = {
      version,
      status: "CONNECTED",
      fingerprint: config.fingerprint,
      realm: config.realm,
      companyName,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      changedAt: new Date().toISOString(),
      secret: sealIntegration(token, key + ":" + version),
    };
    await tx.setting.upsert({
      where: { key },
      create: { key, valueJson: json(value) },
      update: { valueJson: json(value) },
    });
    await audit(tx, actor, "quickbooks.connected", key, config.realm);
  });
  return { connected: true };
}
export async function maintainQuickbooksConnection(
  actor: string,
  action: "refresh" | "disconnect",
) {
  await financeAccess(prisma, actor, true);
  const config = await quickbooksConfig(),
    key = connectionKey();
  const claim = await prisma.$transaction(async (tx) => {
    await lock(tx, key);
    await financeAccess(tx, actor, true);
    const current = await saved(tx, key);
    if (!current || current.status === "DISCONNECTED") return null;
    if (current.fingerprint !== config.fingerprint || !current.secret)
      throw new AccountError(
        "Restore the connection's original app and company settings before continuing.",
        409,
      );
    if (action === "refresh" && current.status !== "CONNECTED")
      throw new AccountError(
        "Reconnect QuickBooks before refreshing this connection.",
        409,
      );
    if (
      action === "refresh" &&
      new Date(current.expiresAt).getTime() > Date.now() + 60000
    )
      return null;
    if (
      current.status === "DISCONNECTING" &&
      Date.now() - new Date(current.changedAt).getTime() < 30000
    )
      throw new AccountError("Disconnect is still being confirmed. Retry shortly.", 409);
    const token = quickbooksTokenSchema.parse(
      openIntegration(current.secret, key + ":" + current.version),
    );
    const version = current.version + 1;
    await tx.setting.update({
      where: { key },
      data: {
        valueJson: json({
          ...current,
          version,
          status: action === "refresh" ? "REFRESHING" : "DISCONNECTING",
          changedAt: new Date().toISOString(),
          secret: sealIntegration(token, key + ":" + version),
        }),
      },
    });
    await audit(tx, actor, "quickbooks." + action + ".started", key, config.realm);
    return { version, token };
  });
  if (!claim) return { complete: true };
  try {
    const token =
      action === "refresh"
        ? await exchangeQuickbooksToken(config, {
            refreshToken: claim.token.refresh_token,
          })
        : null;
    if (action === "disconnect")
      await revokeQuickbooksToken(config, claim.token.refresh_token);
    if ((await quickbooksConfig()).fingerprint !== config.fingerprint)
      throw new AccountError("QuickBooks settings changed.", 409);
    await prisma.$transaction(async (tx) => {
      await lock(tx, key);
      await financeAccess(tx, actor, true);
      const current = await saved(tx, key);
      if (current?.version !== claim.version)
        throw new AccountError("Connection changed. Reload it.", 409);
      const version = current.version + 1;
      await tx.setting.update({
        where: { key },
        data: {
          valueJson: json({
            ...current,
            version,
            status: token ? "CONNECTED" : "DISCONNECTED",
            changedAt: new Date().toISOString(),
            expiresAt: token
              ? new Date(Date.now() + token.expires_in * 1000).toISOString()
              : current.expiresAt,
            secret: token ? sealIntegration(token, key + ":" + version) : null,
          }),
        },
      });
      await audit(tx, actor, "quickbooks." + action + ".confirmed", key, config.realm);
    });
    return { complete: true };
  } catch {
    if (action === "refresh")
      await prisma.$transaction(async (tx) => {
        await lock(tx, key);
        const current = await saved(tx, key);
        if (current?.version === claim.version)
          await tx.setting.update({
            where: { key },
            data: { valueJson: json({ ...current, status: "RECONNECT" }) },
          });
      });
    throw new AccountError(
      action === "refresh"
        ? "Refresh was not confirmed. Reconnect QuickBooks before continuing."
        : "Disconnect was not confirmed. Access is blocked locally; retry disconnect after 30 seconds.",
      503,
    );
  }
}
