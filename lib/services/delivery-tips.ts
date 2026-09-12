import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { deliveryTipAmount, deliveryTipInput } from "@/lib/domain/delivery-tip";
import { matchTipSession } from "@/lib/domain/tip-session";
import { canonicalJson } from "@/lib/commerce/domain";
import {
  createTipSession,
  retrieveTipSession,
  tipConfiguration,
} from "@/lib/commerce/tip-provider";
import { customerIdentity } from "./customer-account";
import { recordedSaleSource } from "./sales-refund-source";
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const idSchema = z.string().min(1).max(100);
async function owned(
  tx: Prisma.TransactionClient,
  actor: string,
  orderId: string,
  lock = false,
) {
  const { user, customer } = await customerIdentity(tx, actor, lock);
  if (lock) await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
  const order = await tx.order.findFirst({
    where: { id: orderId, customerId: customer.id },
  });
  if (!order) throw new AccountError("Order not found.", 404);
  return { user, customer, order };
}
export async function readDeliveryTips(actor: string, orderId: string) {
  idSchema.parse(orderId);
  const data = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const { order } = await owned(tx, actor, orderId);
      const tips = await tx.deliveryTip.findMany({
        where: { orderId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      const sale = await recordedSaleSource(tx, orderId);
      const delivered = await tx.deliveryAttempt.findFirst({
        where: {
          orderId,
          result: "DELIVERED",
          routeStop: { orderId, completedAt: { not: null } },
          photos: { some: {} },
        },
        select: { id: true },
      });
      return {
        orderId,
        number: order.number,
        baseCents: sale.netCents,
        canChoose:
          order.status === "DELIVERED" &&
          Boolean(delivered) &&
          !tips.some((t) => ["PAID", "OPEN", "SUBMITTING", "UNKNOWN"].includes(t.state)),
        tips: tips.map((t) => ({
          id: t.id,
          state: t.state,
          amountCents: t.amountCents,
          taxCents: t.taxCents,
          totalCents: t.totalCents,
          at: t.createdAt.toISOString(),
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  let enabled = false;
  try {
    await tipConfiguration();
    enabled = true;
  } catch {}
  return { ...data, enabled };
}
export async function beginDeliveryTip(actor: string, raw: unknown) {
  const d = deliveryTipInput.parse(raw),
    hash = createHash("sha256").update(canonicalJson(d)).digest("hex");
  const config = d.choice === "DECLINE" ? null : await tipConfiguration();
  const tip = await prisma.$transaction(async (tx) => {
    const { order, user, customer } = await owned(tx, actor, d.orderId, true);
    const old = await tx.deliveryTip.findUnique({
      where: { orderId_requestKey: { orderId: d.orderId, requestKey: d.requestKey } },
    });
    if (old) {
      if (old.requestHash !== hash)
        throw new AccountError(
          "This tip request was already used. Reload before changing it.",
          409,
        );
      return old;
    }
    if (order.status !== "DELIVERED")
      throw new AccountError("Tips are available after confirmed delivery.", 409);
    if (d.choice === "DECLINE") {
      const declined = await tx.deliveryTip.findFirst({
        where: { orderId: order.id, state: "DECLINED" },
      });
      if (declined) return declined;
    }
    if (config && !user.emailVerified)
      throw new AccountError("Verify your email before leaving a tip.", 409);
    if (
      await tx.deliveryTip.findFirst({
        where: {
          orderId: order.id,
          state: { in: ["SUBMITTING", "OPEN", "UNKNOWN", "PAID"] },
        },
      })
    )
      throw new AccountError("An existing tip payment must be resolved first.", 409);
    const sale = await recordedSaleSource(tx, order.id);
    const attempt = await tx.deliveryAttempt.findFirst({
      where: {
        orderId: order.id,
        result: "DELIVERED",
        routeStop: { orderId: order.id, completedAt: { not: null } },
        photos: { some: {} },
      },
      orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
    });
    if (!attempt) throw new AccountError("Confirmed delivery evidence is required.", 409);
    if (
      config &&
      (config.accountId !== sale.providerAccountId || config.live !== sale.livemode)
    )
      throw new AccountError("Original payment account needs review.", 409);
    let amountCents: number;
    try {
      amountCents = deliveryTipAmount(d, sale.netCents);
    } catch (e) {
      throw new AccountError(e instanceof Error ? e.message : "Invalid tip amount.", 400);
    }
    const created = await tx.deliveryTip.create({
      data: {
        orderId: order.id,
        deliveryAttemptId: attempt.id,
        requestKey: d.requestKey,
        requestHash: hash,
        choice: d.choice,
        percent: d.choice === "PERCENT" ? d.percent : null,
        baseCents: sale.netCents,
        amountCents,
        state: d.choice === "DECLINE" ? "DECLINED" : "SUBMITTING",
        source: json({
          sale,
          driverUserId: attempt.driverUserId,
          email: user.email,
          name:
            [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
            user.email,
          address: sale.address,
        }),
        stripeAccountId: sale.providerAccountId,
        livemode: sale.livemode,
        taxCode: config?.taxCode ?? null,
        expiresAt: new Date(Date.now() + 60 * 60000),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "DeliveryTip",
        entityId: created.id,
        action: "delivery.tip.requested",
        afterJson: {
          orderId: order.id,
          choice: d.choice,
          amountCents,
          driverUserId: attempt.driverUserId,
        },
      },
    });
    return created;
  });
  if (["DECLINED", "PAID", "EXPIRED"].includes(tip.state))
    return { id: tip.id, state: tip.state, url: null };
  try {
    if (!tip.stripeSessionId) {
      const result = await createTipSession(tip);
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${tip.orderId} FOR UPDATE`;
        const current = await tx.deliveryTip.findUniqueOrThrow({ where: { id: tip.id } });
        matchTipSession(
          { ...current, stripeCustomerId: result.customerId },
          result.session,
        );
        if (current.stripeSessionId && current.stripeSessionId !== result.session.id)
          throw new AccountError("Tip session changed.", 409);
        await tx.deliveryTip.update({
          where: { id: tip.id },
          data: {
            stripeSessionId: result.session.id,
            stripeCustomerId: result.customerId,
          },
        });
      });
    }
    return await reconcileDeliveryTip(tip.id);
  } catch (e) {
    await prisma.deliveryTip.updateMany({
      where: { id: tip.id, state: { in: ["SUBMITTING", "OPEN", "UNKNOWN"] } },
      data: { state: "UNKNOWN" },
    });
    throw e;
  }
}
export async function reconcileDeliveryTip(id: string, observedSessionId?: string) {
  idSchema.parse(id);
  const before = await prisma.deliveryTip.findUniqueOrThrow({ where: { id } }),
    sessionId = before.stripeSessionId ?? observedSessionId;
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId))
    throw new AccountError("Tip payment needs provider reconciliation.", 409);
  const session = await retrieveTipSession(before, sessionId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${before.orderId} FOR UPDATE`;
    const current = await tx.deliveryTip.findUniqueOrThrow({ where: { id } });
    if (current.state === "DECLINED")
      throw new AccountError("A declined tip cannot be charged.", 409);
    const match = matchTipSession(current, session);
    if (
      current.state === "PAID" &&
      (match.state !== "PAID" ||
        current.paymentIntentId !== match.paymentIntentId ||
        current.taxCents !== match.taxCents ||
        current.totalCents !== match.totalCents)
    )
      throw new AccountError("Settled tip evidence changed. Review required.", 409);
    const fields = {
      state: match.state,
      stripeSessionId: session.id,
      stripeCustomerId: match.customerId,
      recoveryCheckedAt: new Date(),
      ...(match.state === "PAID"
        ? {
            paymentIntentId: match.paymentIntentId,
            taxCents: match.taxCents,
            totalCents: match.totalCents,
            paidAt: current.paidAt ?? new Date(),
          }
        : {}),
    };
    await tx.deliveryTip.update({ where: { id }, data: fields });
    if (current.state !== match.state)
      await tx.auditLog.create({
        data: {
          entityType: "DeliveryTip",
          entityId: id,
          action: "delivery.tip.reconciled",
          beforeJson: { state: current.state },
          afterJson: json({
            ...fields,
            source: "stripe-api",
            accountId: current.stripeAccountId,
            livemode: current.livemode,
          }),
        },
      });
    let url: string | null = null;
    if (match.state === "OPEN" && session.url) {
      const parsed = new URL(session.url);
      if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "checkout.stripe.com" ||
        parsed.username ||
        parsed.password
      )
        throw new AccountError("Tip payment URL could not be verified.", 409);
      url = parsed.href;
    }
    return { id, state: match.state, url };
  });
}
export async function reconcileOwnedDeliveryTip(actor: string, id: string) {
  idSchema.parse(id);
  const tip = await prisma.deliveryTip.findUnique({ where: { id } });
  if (!tip) throw new AccountError("Tip not found.", 404);
  await owned(prisma, actor, tip.orderId);
  return reconcileDeliveryTip(id);
}
export async function recoverDeliveryTips(ownsLease: () => Promise<boolean>) {
  const rows = await prisma.deliveryTip.findMany({
    where: { state: { in: ["SUBMITTING", "OPEN", "UNKNOWN"] } },
    orderBy: [
      { recoveryCheckedAt: { sort: "asc", nulls: "first" } },
      { createdAt: "asc" },
    ],
    take: 10,
  });
  let completed = 0,
    attention = 0;
  for (const t of rows) {
    if (!(await ownsLease())) throw Error("Worker lease expired.");
    await prisma.deliveryTip.update({
      where: { id: t.id },
      data: { recoveryCheckedAt: new Date() },
    });
    try {
      await reconcileDeliveryTip(t.id);
      completed++;
    } catch {
      attention++;
    }
  }
  return { checked: rows.length, completed, attention };
}
