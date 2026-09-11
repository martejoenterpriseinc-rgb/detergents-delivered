import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { customerIdentity } from "./customer-account";
import { AccountError } from "@/lib/domain/account";
import { integrationEnvironment } from "@/lib/integration-environment";
export const commerceScopes = [
  "orders.read",
  "subscriptions.read",
  "rewards.read",
  "quotes.create",
] as const;
export type CommerceScope = (typeof commerceScopes)[number];
const consentVersion = "commerce-delegation-v1";
const issueInput = z
  .object({
    requestKey: z.string().uuid(),
    label: z.string().trim().min(2).max(80),
    scopes: z.array(z.enum(commerceScopes)).min(1).max(4),
    days: z.number().int().min(1).max(7),
    consentVersion: z.literal(consentVersion),
    confirmed: z.literal(true),
  })
  .strict();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const denied = () =>
  new AccountError("Commerce access is invalid, expired or revoked.", 401);
async function household(tx: Prisma.TransactionClient, actor: string) {
  const identity = await customerIdentity(tx, actor);
  if (!identity.user.emailVerified)
    throw new AccountError("Verify your email before connecting an application.", 403);
  return identity;
}
export async function listCommerceGrants(actor: string) {
  const { user, customer } = await customerIdentity(prisma, actor);
  const now = new Date();
  const active = { customerId: customer.id, revokedAt: null, expiresAt: { gt: now } };
  const [open, history] = await Promise.all([
    prisma.commerceGrant.findMany({
      where: active,
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.commerceGrant.findMany({
      where: {
        customerId: customer.id,
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return [...open, ...history].map((grant) => ({
    id: grant.id,
    label: grant.label,
    scopes: grant.scopes,
    expiresAt: grant.expiresAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
    active:
      !grant.revokedAt &&
      grant.expiresAt > now &&
      grant.environment === integrationEnvironment() &&
      grant.consentVersion === consentVersion &&
      grant.sessionVersion === user.sessionVersion &&
      Boolean(user.emailVerified),
  }));
}
export async function issueCommerceGrant(actor: string, raw: unknown) {
  const input = issueInput.parse(raw),
    environment = integrationEnvironment();
  if (!environment) throw denied();
  const scopes = [...new Set(input.scopes)].sort();
  const fingerprint = digest(
    JSON.stringify({ label: input.label, scopes, days: input.days, consentVersion }),
  );
  const id = "cg_" + digest(actor + ":" + input.requestKey);
  const token = `ddg_${environment}_${randomBytes(32).toString("hex")}`;
  return prisma.$transaction(async (tx) => {
    const initial = await household(tx, actor);
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${initial.customer.id} FOR UPDATE`;
    const { user, customer } = await household(tx, actor);
    const prior = await tx.commerceGrant.findUnique({ where: { id } });
    if (prior) {
      if (prior.requestHash !== fingerprint)
        throw new AccountError(
          "This connection request was used for different permissions.",
          409,
        );
      return { id: prior.id, token: null, alreadyIssued: true };
    }
    if (
      (await tx.commerceGrant.count({
        where: {
          customerId: customer.id,
          createdAt: { gte: new Date(Date.now() - 3_600_000) },
        },
      })) >= 10
    )
      throw new AccountError("Too many new connections. Try again in an hour.", 429);
    if (
      (await tx.commerceGrant.count({
        where: {
          customerId: customer.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      })) >= 5
    )
      throw new AccountError("Revoke an existing connection before adding another.", 409);
    const grant = await tx.commerceGrant.create({
      data: {
        id,
        customerId: customer.id,
        userId: user.id,
        tokenHash: digest(token),
        requestHash: fingerprint,
        sessionVersion: user.sessionVersion,
        environment,
        label: input.label,
        scopes,
        consentVersion,
        expiresAt: new Date(Date.now() + input.days * 86_400_000),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "commerce.grant.created",
        entityType: "CommerceGrant",
        entityId: id,
        afterJson: {
          label: input.label,
          scopes,
          environment,
          expiresAt: grant.expiresAt.toISOString(),
          consentVersion,
        },
      },
    });
    return { id, token, alreadyIssued: false };
  });
}
export async function revokeCommerceGrant(actor: string, raw: unknown) {
  const { id } = z
    .object({ id: z.string().regex(/^cg_[a-f0-9]{64}$/) })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    const initial = await customerIdentity(tx, actor);
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${initial.customer.id} FOR UPDATE`;
    const { customer } = await customerIdentity(tx, actor);
    const grant = await tx.commerceGrant.findUnique({ where: { id } });
    if (!grant || grant.customerId !== customer.id)
      throw new AccountError("Connection not found.", 404);
    if (grant.revokedAt) return { revoked: true };
    await tx.commerceGrant.update({ where: { id }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "commerce.grant.revoked",
        entityType: "CommerceGrant",
        entityId: id,
      },
    });
    return { revoked: true };
  });
}
export type GrantIdentity = {
  id: string;
  userId: string;
  customerId: string;
  scope: CommerceScope;
  tokenHash: string;
};
export async function validateCommerceGrant(
  tx: Prisma.TransactionClient,
  identity: GrantIdentity,
) {
  const grant = await tx.commerceGrant.findUnique({ where: { id: identity.id } });
  if (
    !grant ||
    grant.userId !== identity.userId ||
    grant.customerId !== identity.customerId ||
    grant.tokenHash !== identity.tokenHash ||
    grant.consentVersion !== consentVersion ||
    grant.environment !== integrationEnvironment() ||
    grant.revokedAt ||
    grant.expiresAt <= new Date() ||
    !grant.scopes.includes(identity.scope)
  )
    throw denied();
  const { user, customer } = await household(tx, grant.userId);
  if (customer.id !== grant.customerId || user.sessionVersion !== grant.sessionVersion)
    throw denied();
}
export async function authorizeCommerceGrant(
  header: string | null,
  scope: CommerceScope,
): Promise<GrantIdentity> {
  const matched = /^Bearer (ddg_(sandbox|live)_[a-f0-9]{64})$/.exec(header ?? "");
  if (!matched || matched[2] !== integrationEnvironment()) throw denied();
  const tokenHash = digest(matched[1]);
  const initial = await prisma.commerceGrant.findUnique({ where: { tokenHash } });
  if (!initial) throw denied();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${initial.customerId} FOR UPDATE`;
    const identity = {
      id: initial.id,
      userId: initial.userId,
      customerId: initial.customerId,
      tokenHash,
      scope,
    };
    await validateCommerceGrant(tx, identity);
    const grant = await tx.commerceGrant.findUniqueOrThrow({ where: { id: initial.id } });
    const now = new Date(),
      reset =
        !grant.windowStartedAt ||
        now.getTime() - grant.windowStartedAt.getTime() >= 60_000;
    if (!reset && grant.requestCount >= 60)
      throw new AccountError(
        "Connection request limit reached. Retry in one minute.",
        429,
      );
    await tx.commerceGrant.update({
      where: { id: grant.id },
      data: {
        lastUsedAt: now,
        windowStartedAt: reset ? now : grant.windowStartedAt,
        requestCount: reset ? 1 : grant.requestCount + 1,
      },
    });
    return identity;
  });
}
