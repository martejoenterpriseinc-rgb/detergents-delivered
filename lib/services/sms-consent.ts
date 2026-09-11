import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { customerIdentity } from "./customer-account";
import { smsConfig } from "@/lib/integrations/twilio-client";
import { AccountError } from "@/lib/domain/account";
import {
  smsConsentInput,
  smsConsentVersion,
  smsPhone,
  smsStopWords,
} from "@/lib/domain/delivery-sms";
import { integrationEnvironment } from "@/lib/integration-environment";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function smsConsentStatus(userId: string) {
  const { customer } = await customerIdentity(prisma, userId);
  const mode = integrationEnvironment();
  const current = mode
    ? await prisma.smsConsent.findFirst({
        where: { customerId: customer.id, environment: mode },
        orderBy: { createdAt: "desc" },
      })
    : null;
  let sender: string | null = null;
  let matches = false;
  try {
    const config = await smsConfig();
    sender = config.sender;
    matches = Boolean(
      current &&
      current.accountSid === config.accountSid &&
      current.sender === config.sender,
    );
  } catch {}
  return {
    available: Boolean(sender),
    sender,
    state: current?.state ?? "NOT_STARTED",
    expiresAt: current?.expiresAt.toISOString() ?? null,
    active: Boolean(
      current?.state === "ACTIVE" &&
      matches &&
      customer.smsNotifications &&
      smsPhone(customer.phone ?? "") === current.phone,
    ),
    timezone: current?.timezone ?? null,
  };
}
export async function beginSmsConsent(userId: string, raw: unknown) {
  const input = smsConsentInput.parse(raw),
    config = await smsConfig(),
    code = randomBytes(5).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + 900000);
  await prisma.$transaction(async (tx) => {
    const { user, customer } = await customerIdentity(tx, userId, true);
    if (!user.emailVerified)
      throw new AccountError("Verify your email before activating delivery texts.", 403);
    const phone = smsPhone(customer.phone ?? "");
    if (!phone)
      throw new AccountError(
        "Save your phone with its country code, for example +1, before activating texts.",
      );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"SMS:" + config.mode + ":" + phone},0))`;
    if (
      (await tx.smsConsent.count({
        where: {
          customerId: customer.id,
          createdAt: { gt: new Date(Date.now() - 3600000) },
        },
      })) >= 5
    )
      throw new AccountError(
        "Too many verification requests. Try again in an hour.",
        429,
      );
    await tx.smsConsent.updateMany({
      where: {
        customerId: customer.id,
        environment: config.mode,
        state: { not: "REVOKED" },
      },
      data: { state: "REVOKED", revokedAt: new Date() },
    });
    const consent = await tx.smsConsent.create({
      data: {
        customerId: customer.id,
        environment: config.mode,
        accountSid: config.accountSid,
        sender: config.sender,
        phone,
        timezone: input.timezone,
        consentVersion: smsConsentVersion,
        codeHash: hash(code),
        expiresAt,
      },
    });
    await tx.customer.update({
      where: { id: customer.id },
      data: { smsNotifications: true },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "sms.consent.requested",
        entityType: "SmsConsent",
        entityId: consent.id,
        afterJson: {
          version: smsConsentVersion,
          timezone: input.timezone,
          environment: config.mode,
        },
      },
    });
  });
  return {
    message: "DD " + code,
    sender: config.sender,
    expiresAt: expiresAt.toISOString(),
  };
}
export async function stopSmsConsent(userId: string) {
  return prisma.$transaction(async (tx) => {
    const { customer } = await customerIdentity(tx, userId, true);
    const count = await tx.smsConsent.updateMany({
      where: { customerId: customer.id, state: { not: "REVOKED" } },
      data: { state: "REVOKED", revokedAt: new Date() },
    });
    await tx.customer.update({
      where: { id: customer.id },
      data: { smsNotifications: false },
    });
    if (count.count)
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "sms.consent.revoked",
          entityType: "Customer",
          entityId: customer.id,
        },
      });
    return { stopped: true };
  });
}
export async function receiveSmsConsent(
  config: Awaited<ReturnType<typeof smsConfig>>,
  fields: Record<string, string>,
) {
  const input = z
    .object({
      MessageSid: z.string().regex(/^SM[a-f0-9]{32}$/i),
      AccountSid: z.literal(config.accountSid),
      From: z.string(),
      To: z.literal(config.sender),
      Body: z.string().max(1600),
    })
    .parse(fields);
  const phone = smsPhone(input.From);
  if (!phone) throw new AccountError("Invalid sender.");
  const body = input.Body.trim().toUpperCase();
  const stop = smsStopWords.has(body) || fields.OptOutType === "STOP";
  const code = /^DD ([A-F0-9]{10})$/.exec(body)?.[1];
  if (!stop && !code) return;
  const id = config.mode + ":" + config.accountSid + ":" + input.MessageSid,
    eventHash = hash(JSON.stringify(input));
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"SMS:" + config.mode + ":" + phone},0))`;
    const prior = await tx.smsInboundEvent.findUnique({ where: { id } });
    if (prior) {
      if (prior.eventHash !== eventHash)
        throw new AccountError("Callback evidence changed.", 409);
      return;
    }
    await tx.smsInboundEvent.create({
      data: { id, eventHash, kind: stop ? "STOP" : "VERIFY" },
    });
    if (stop) {
      const consents = await tx.smsConsent.findMany({
        where: {
          environment: config.mode,
          accountSid: config.accountSid,
          phone,
          state: { not: "REVOKED" },
        },
        select: { id: true, customerId: true },
      });
      await tx.smsConsent.updateMany({
        where: { id: { in: consents.map((c) => c.id) } },
        data: { state: "REVOKED", revokedAt: new Date() },
      });
      await tx.customer.updateMany({
        where: { id: { in: consents.map((c) => c.customerId) } },
        data: { smsNotifications: false },
      });
      await tx.auditLog.create({
        data: {
          action: "sms.consent.stopped",
          entityType: "SmsInboundEvent",
          entityId: id,
          afterJson: { revoked: consents.length },
        },
      });
      return;
    }
    const consent = await tx.smsConsent.findUnique({
      where: { codeHash: hash(code!) },
      include: { customer: { include: { user: true } } },
    });
    if (
      !consent ||
      consent.state !== "PENDING" ||
      consent.expiresAt <= new Date() ||
      consent.environment !== config.mode ||
      consent.accountSid !== config.accountSid ||
      consent.sender !== config.sender ||
      consent.phone !== phone
    )
      return;
    const customer = consent.customer;
    if (
      customer.deletedAt ||
      customer.user.deletedAt ||
      customer.user.mustChangeCredentials ||
      !customer.user.emailVerified ||
      !customer.smsNotifications ||
      smsPhone(customer.phone ?? "") !== phone
    )
      return;
    await tx.smsConsent.update({
      where: { id: consent.id },
      data: { state: "ACTIVE", activatedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        action: "sms.consent.verified",
        entityType: "SmsConsent",
        entityId: consent.id,
        afterJson: { messageSid: input.MessageSid, version: consent.consentVersion },
      },
    });
  });
}
