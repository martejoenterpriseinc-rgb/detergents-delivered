import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, type SmsDelivery } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { smsConfig } from "@/lib/integrations/twilio-client";
import {
  submitDeliveryText,
  readDeliveryText,
  SmsRateLimit,
  smsReceipt,
} from "@/lib/integrations/twilio-delivery";
import { smsDeliveryHour, smsPhone } from "@/lib/domain/delivery-sms";
import { AccountError } from "@/lib/domain/account";
import { operationsStaff } from "./operations";
type Config = Awaited<ReturnType<typeof smsConfig>>;
const terminal = new Set(["DELIVERED", "FAILED", "SKIPPED"]);
const statusOf = (status: string) =>
  status === "delivered"
    ? "DELIVERED"
    : ["failed", "undelivered", "canceled"].includes(status)
      ? "FAILED"
      : status === "sent"
        ? "SENT"
        : "QUEUED";
async function lock(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"SMSOUT:" + id},0))`;
}
function allowed(config: Config) {
  return (
    process.env.DD_SMS_DELIVERY_ENABLED === "true" &&
    process.env.DD_SMS_DELIVERY_ACCOUNT ===
      `${config.mode}:${config.accountSid}:${config.sender}`
  );
}
function recipientAllowed(config: Config, phone: string) {
  return (
    config.mode === "live" ||
    (process.env.DD_SMS_ALLOWED_RECIPIENTS ?? "")
      .split(",")
      .map((v) => v.trim())
      .includes(phone)
  );
}
function sameCompany(row: SmsDelivery, config: Config) {
  return (
    row.environment === config.mode &&
    row.accountSid === config.accountSid &&
    row.sender === config.sender
  );
}
async function recordStatus(config: Config, id: string, sid: string, status: string) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const row = await tx.smsDelivery.findUniqueOrThrow({ where: { id } });
    if (
      !sameCompany(row, config) ||
      row.attempts === 0 ||
      !row.body ||
      !row.submittedAt ||
      row.status === "SKIPPED"
    )
      throw new AccountError("Text submission does not match.", 409);
    if (row.providerSid && row.providerSid !== sid)
      throw new AccountError("Text provider identity changed.", 409);
    const eventId = createHash("sha256")
      .update(id + ":" + sid + ":" + status)
      .digest("hex");
    if (await tx.smsDeliveryEvent.findUnique({ where: { id: eventId } })) {
      await tx.smsDelivery.update({
        where: { id },
        data: {
          checkedAt: new Date(),
          ...([
            "DELIVERY_EVIDENCE_UNCONFIRMED",
            "SUBMISSION_UNCONFIRMED",
            "DELIVERY_UNCONFIRMED",
          ].includes(row.issue ?? "")
            ? { issue: null }
            : {}),
        },
      });
      return;
    }
    await tx.smsDeliveryEvent.create({
      data: { id: eventId, deliveryId: id, providerSid: sid, status },
    });
    const next = statusOf(status);
    const conflict =
      terminal.has(row.status) &&
      row.status !== next &&
      ["DELIVERED", "FAILED"].includes(next);
    const rank: Record<string, number> = {
      PENDING: 0,
      SUBMITTING: 0,
      UNKNOWN: 0,
      QUEUED: 1,
      SENT: 2,
      DELIVERED: 3,
      FAILED: 3,
      SKIPPED: 3,
    };
    await tx.smsDelivery.update({
      where: { id },
      data: {
        providerSid: sid,
        checkedAt: new Date(),
        ...(conflict
          ? { issue: "DELIVERY_EVIDENCE_CHANGED" }
          : !terminal.has(row.status) && rank[next] >= rank[row.status]
            ? {
                status: next,
                issue: next === "FAILED" ? "PROVIDER_DELIVERY_FAILED" : null,
              }
            : {}),
      },
    });
  });
}
async function confirmReceipt(config: Config, row: SmsDelivery, raw: unknown) {
  const receipt = smsReceipt.parse(raw);
  if (
    receipt.account_sid !== row.accountSid ||
    receipt.from !== row.sender ||
    receipt.to !== row.phone ||
    receipt.body !== row.body
  )
    throw new Error("Text receipt mismatch.");
  await recordStatus(config, row.id, receipt.sid, receipt.status);
}
export async function receiveDeliveryTextStatus(
  config: Config,
  id: string,
  fields: Record<string, string>,
) {
  z.uuid().parse(id);
  const value = z
    .object({
      AccountSid: z.literal(config.accountSid),
      MessageSid: z.string().regex(/^SM[a-f0-9]{32}$/i),
      From: z.literal(config.sender),
      To: z.string(),
      MessageStatus: z.enum([
        "accepted",
        "queued",
        "sending",
        "sent",
        "delivered",
        "undelivered",
        "failed",
        "canceled",
      ]),
    })
    .parse(fields);
  const row = await prisma.smsDelivery.findUnique({ where: { id } });
  if (!row || row.phone !== value.To || !sameCompany(row, config))
    throw new AccountError("Unknown delivery text.", 404);
  await recordStatus(config, id, value.MessageSid, value.MessageStatus);
}
async function claimText(config: Config, id: string, now: Date) {
  return prisma.$transaction(async (tx) => {
    const first = await tx.smsDelivery.findUniqueOrThrow({ where: { id } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"SMS:" + config.mode + ":" + first.phone},0))`;
    await lock(tx, id);
    const row = await tx.smsDelivery.findUniqueOrThrow({
      where: { id },
      include: {
        consent: { include: { customer: { include: { user: true } } } },
        order: true,
      },
    });
    if (
      row.status !== "PENDING" ||
      row.nextAttemptAt > now ||
      row.attempts >= 5 ||
      !sameCompany(row, config) ||
      !allowed(config)
    )
      return null;
    const c = row.consent,
      customer = c.customer;
    if (
      c.state !== "ACTIVE" ||
      c.environment !== row.environment ||
      c.accountSid !== row.accountSid ||
      c.sender !== row.sender ||
      c.phone !== row.phone ||
      !customer.smsNotifications ||
      customer.deletedAt ||
      customer.user.deletedAt ||
      !customer.user.emailVerified ||
      customer.user.mustChangeCredentials ||
      smsPhone(customer.phone ?? "") !== row.phone ||
      row.order.status !== row.kind ||
      row.expiresAt <= now
    ) {
      await tx.smsDelivery.update({
        where: { id },
        data: { status: "SKIPPED", issue: null },
      });
      return null;
    }
    if (!recipientAllowed(config, row.phone)) {
      await tx.smsDelivery.update({
        where: { id },
        data: {
          nextAttemptAt: new Date(now.getTime() + 60000),
          issue: "RECIPIENT_NOT_ALLOWED",
        },
      });
      return null;
    }
    if (!smsDeliveryHour(c.timezone, now)) {
      await tx.smsDelivery.update({
        where: { id },
        data: { nextAttemptAt: new Date(now.getTime() + 1800000) },
      });
      return null;
    }
    const body = `Detergents Delivered: ${row.kind === "DELIVERED" ? "Your delivery is complete." : "Your delivery is on its way."} View updates: ${config.origin}/account?order=${encodeURIComponent(row.orderId)} Reply STOP to opt out.`;
    if (row.body && row.body !== body) {
      await tx.smsDelivery.update({
        where: { id },
        data: { status: "SKIPPED", issue: "APPLICATION_ORIGIN_CHANGED" },
      });
      return null;
    }
    const claimed = await tx.smsDelivery.update({
      where: { id },
      data: {
        status: "SUBMITTING",
        body,
        attempts: { increment: 1 },
        submittedAt: row.submittedAt ?? now,
        issue: null,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "sms.delivery.submitting",
        entityType: "SmsDelivery",
        entityId: id,
        afterJson: { orderId: row.orderId, kind: row.kind, attempt: claimed.attempts },
      },
    });
    return claimed;
  });
}
export async function runDeliveryTexts(
  ownsLease: () => Promise<boolean>,
  now = new Date(),
) {
  if (!(await ownsLease())) throw new Error("Worker lease expired.");
  const config = await smsConfig(),
    company = {
      environment: config.mode,
      accountSid: config.accountSid,
      sender: config.sender,
    };
  let checked = 0,
    completed = 0;
  const recover = await prisma.smsDelivery.findMany({
    where: {
      ...company,
      status: { in: ["SUBMITTING", "UNKNOWN", "QUEUED", "SENT"] },
      OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - 60000) } }],
    },
    orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: 5,
  });
  for (const row of recover) {
    if (!(await ownsLease())) throw new Error("Worker lease expired.");
    checked++;
    await prisma.smsDelivery.update({ where: { id: row.id }, data: { checkedAt: now } });
    if (!row.providerSid) {
      await prisma.smsDelivery.updateMany({
        where: {
          id: row.id,
          status: { in: ["SUBMITTING", "UNKNOWN"] },
          providerSid: null,
        },
        data: { status: "UNKNOWN", issue: "SUBMISSION_UNCONFIRMED" },
      });
      continue;
    }
    try {
      await confirmReceipt(config, row, await readDeliveryText(config, row.providerSid));
      completed++;
    } catch {
      await prisma.smsDelivery.update({
        where: { id: row.id },
        data: { issue: "DELIVERY_EVIDENCE_UNCONFIRMED" },
      });
    }
  }
  if (allowed(config)) {
    const rows = await prisma.smsDelivery.findMany({
      where: { ...company, status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: 5,
    });
    let lastSendAt = 0;
    for (const row of rows) {
      if (lastSendAt)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, 1000 - (Date.now() - lastSendAt))),
        );
      if (!(await ownsLease())) throw new Error("Worker lease expired.");
      checked++;
      const claim = await claimText(config, row.id, now);
      if (!claim) continue;
      lastSendAt = Date.now();
      try {
        await confirmReceipt(
          config,
          claim,
          await submitDeliveryText(config, claim.id, claim.phone, claim.body!),
        );
        completed++;
      } catch (e) {
        if (e instanceof SmsRateLimit) {
          await prisma.smsDelivery.updateMany({
            where: { id: claim.id, status: "SUBMITTING", providerSid: null },
            data:
              claim.attempts >= 5
                ? { status: "FAILED", issue: "RATE_LIMIT_EXHAUSTED" }
                : {
                    status: "PENDING",
                    nextAttemptAt: new Date(
                      now.getTime() +
                        Math.round(
                          60000 * 2 ** claim.attempts * (0.9 + Math.random() * 0.2),
                        ),
                    ),
                    issue: null,
                  },
          });
        } else {
          await prisma.smsDelivery.updateMany({
            where: { id: claim.id, status: "SUBMITTING" },
            data: { status: "UNKNOWN", issue: "SUBMISSION_UNCONFIRMED" },
          });
        }
      }
    }
  }
  const attention = await prisma.smsDelivery.count({
    where: {
      ...company,
      OR: [{ status: { in: ["UNKNOWN", "FAILED"] } }, { issue: { not: null } }],
    },
  });
  return { checked, completed, attention, enabled: allowed(config) };
}
export async function deliveryTextStatus(actor: string) {
  await operationsStaff(prisma, actor);
  const config = await smsConfig();
  const rows = await prisma.smsDelivery.findMany({
    where: {
      environment: config.mode,
      accountSid: config.accountSid,
      sender: config.sender,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { order: { select: { number: true } } },
  });
  return {
    enabled: allowed(config),
    rows: rows.map((row) => ({
      id: row.id,
      order: row.order.number,
      kind: row.kind,
      status: row.status,
      issue: row.issue,
      attempts: row.attempts,
      createdAt: row.createdAt.toISOString(),
      checkedAt: row.checkedAt?.toISOString() ?? null,
    })),
  };
}
