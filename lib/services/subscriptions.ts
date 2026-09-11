import { createHash } from "node:crypto";
import type { Prisma, Subscription } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { customerIdentity } from "./customer-account";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import { canonicalJson } from "@/lib/commerce/domain";
import {
  subscriptionCreateInput,
  subscriptionChangeInput,
  subscriptionConsentVersion,
  subscriptionConsent,
  quarterDate,
  upcomingQuarter,
} from "@/lib/domain/subscriptions";

import { changeSubscriptionCycles } from "./subscription-cycles";
type Tx = Prisma.TransactionClient;
const digest = (v: unknown) =>
  createHash("sha256").update(canonicalJson(v)).digest("hex");
const date = (v: Date | null) => v?.toISOString().slice(0, 10) ?? null;
function publicSubscription(s: Subscription) {
  return {
    id: s.id,
    status: s.status,
    version: s.version,
    quarterly: s.cadenceMonths === 3 && s.consentVersion === subscriptionConsentVersion,
    nextDate: date(s.nextOrderAt),
    anchorDate: date(s.anchorDate),
    cycleNumber: s.cycleNumber,
  };
}
async function lockCustomer(tx: Tx, userId: string) {
  const identity = await customerIdentity(tx, userId);
  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${identity.customer.id} FOR UPDATE`;
  // Refresh after waiting for the wallet/household lock.
  return customerIdentity(tx, userId);
}
async function replay(tx: Tx, key: string, hash: string, userId: string) {
  const event = await tx.subscriptionEvent.findUnique({
    where: { requestKey: key },
    include: { subscription: true },
  });
  if (!event) return null;
  if (event.actorUserId !== userId || event.requestHash !== hash)
    throw new AccountError(
      "This save was already used for different subscription changes.",
      409,
    );
  return publicSubscription(event.subscription);
}
async function record(
  tx: Tx,
  userId: string,
  requestKey: string,
  requestHash: string,
  action: string,
  saved: Subscription,
  before: unknown,
) {
  const after = publicSubscription(saved);
  const evidence = JSON.parse(
    JSON.stringify({ before, after, consentVersion: saved.consentVersion }),
  );
  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: saved.id,
      actorUserId: userId,
      requestKey,
      requestHash,
      action,
      evidence,
    },
  });
  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      action: `subscription.${action}`,
      entityType: "Subscription",
      entityId: saved.id,
      afterJson: evidence,
    },
  });
  return after;
}
export async function createSubscription(userId: string, raw: unknown) {
  const input = subscriptionCreateInput.parse(raw),
    hash = digest({ userId, input });
  return prisma.$transaction(async (tx) => {
    const { user, customer } = await lockCustomer(tx, userId);
    const prior = await replay(tx, input.requestKey, hash, userId);
    if (prior) return prior;
    if (!user.emailVerified || !customer.purchaseApprovedAt)
      throw new AccountError(
        "Verify your email and purchase approval before starting a subscription.",
        403,
      );
    if (
      (await tx.subscription.count({
        where: { customerId: customer.id, status: { not: "CANCELLED" } },
      })) >= 20
    )
      throw new AccountError(
        "Manage your existing subscriptions before adding another.",
        409,
      );
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.originOrderId} FOR UPDATE`;
    const order = await tx.order.findFirst({
      where: { id: input.originOrderId, customerId: customer.id },
      include: {
        items: true,
        subscription: true,
        checkoutAttempt: true,
        payments: { include: { events: true } },
      },
    });
    if (!order) throw new AccountError("Order not found.", 404);
    if (order.subscription)
      throw new AccountError(
        "This order already has a subscription. Manage that subscription instead.",
        409,
      );
    if (
      !order.addressId ||
      order.currency !== "USD" ||
      order.totalCents <= 0 ||
      !["PAID", "FULFILLING", "OUT_FOR_DELIVERY", "DELIVERED"].includes(order.status) ||
      order.checkoutAttempt?.state !== "PAID" ||
      !order.payments.some(
        (p) =>
          p.provider === "STRIPE" &&
          p.currency === "USD" &&
          Boolean(p.externalId?.startsWith("pi_")) &&
          p.status === "CAPTURED" &&
          p.amountCents === order.totalCents &&
          p.events.some(
            (e) =>
              e.verifiedAt &&
              e.externalId === `checkout:${order.checkoutAttempt!.id}:paid` &&
              ["checkout.session.completed", "checkout.session.reconciled"].includes(
                e.type,
              ),
          ),
      )
    )
      throw new AccountError(
        "Choose an order with a verified completed payment and delivery address.",
        409,
      );
    if (
      !order.items.length ||
      order.items.length > 30 ||
      order.items.some((i) => i.quantity < 1 || i.quantity > 100) ||
      new Set(order.items.map((i) => i.productVariantId)).size !== order.items.length
    )
      throw new AccountError("This order needs review before it can be repeated.", 409);
    const anchor = businessDate();
    const saved = await tx.subscription.create({
      data: {
        customerId: customer.id,
        originOrderId: order.id,
        addressId: order.addressId,
        cadenceDays: null,
        cadenceMonths: 3,
        anchorDate: new Date(anchor),
        cycleNumber: 1,
        nextOrderAt: new Date(quarterDate(anchor, 1)),
        consentVersion: subscriptionConsentVersion,
        consentedAt: new Date(),
        items: {
          create: order.items.map((i) => ({
            productVariantId: i.productVariantId,
            quantity: i.quantity,
          })),
        },
      },
    });
    return record(tx, userId, input.requestKey, hash, "created", saved, {
      consent: subscriptionConsent,
    });
  });
}
export async function changeSubscription(userId: string, raw: unknown) {
  const input = subscriptionChangeInput.parse(raw),
    hash = digest({ userId, input });
  return prisma.$transaction(async (tx) => {
    const { customer } = await lockCustomer(tx, userId);
    const prior = await replay(tx, input.requestKey, hash, userId);
    if (prior) return prior;
    await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${input.id} FOR UPDATE`;
    const s = await tx.subscription.findFirst({
      where: { id: input.id, customerId: customer.id },
    });
    if (!s) throw new AccountError("Subscription not found.", 404);
    if (s.version !== input.version)
      throw new AccountError("Subscription changed. Refresh before saving.", 409);
    if (s.status === "CANCELLED")
      throw new AccountError(
        "This subscription is canceled. Start again from a new paid order.",
        409,
      );
    const modern =
      s.cadenceMonths === 3 &&
      s.anchorDate &&
      s.consentVersion === subscriptionConsentVersion;
    if (!modern && !["pause", "cancel"].includes(input.action))
      throw new AccountError(
        "This older schedule needs new quarterly consent. It cannot be resumed automatically.",
        409,
      );
    let fields: Prisma.SubscriptionUpdateInput;
    if (input.action === "cancel")
      fields = { status: "CANCELLED", cancelledAt: new Date(), nextOrderAt: null };
    else if (input.action === "pause") {
      if (s.status === "PAUSED")
        throw new AccountError("Subscription is already paused.", 409);
      fields = { status: "PAUSED" };
    } else if (input.action === "resume") {
      if (s.status !== "PAUSED")
        throw new AccountError("Only a paused subscription can be resumed.", 409);
      const next = upcomingQuarter(date(s.anchorDate)!, s.cycleNumber, businessDate());
      fields = {
        status: "ACTIVE",
        cycleNumber: next.cycle,
        nextOrderAt: new Date(next.date),
      };
    } else {
      if (s.status !== "ACTIVE")
        throw new AccountError(
          "Only an active subscription can skip its next quarter.",
          409,
        );
      const next = upcomingQuarter(
        date(s.anchorDate)!,
        s.cycleNumber + 1,
        businessDate(),
      );
      fields = { cycleNumber: next.cycle, nextOrderAt: new Date(next.date) };
    }
    await changeSubscriptionCycles(tx, s, input.action);
    const saved = await tx.subscription.update({
      where: { id: s.id },
      data: { ...fields, version: { increment: 1 } },
    });
    return record(
      tx,
      userId,
      input.requestKey,
      hash,
      input.action,
      saved,
      publicSubscription(s),
    );
  });
}
export async function readSubscriptions(userId: string) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const { user, customer } = await customerIdentity(tx, userId);
      const subscriptions = await tx.subscription.findMany({
        where: { customerId: customer.id },
        include: {
          originOrder: { select: { number: true } },
          items: {
            include: {
              productVariant: {
                select: { name: true, product: { select: { name: true } } },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 100,
      });
      const orders = await tx.order.findMany({
        where: {
          customerId: customer.id,
          addressId: { not: null },
          subscription: null,
          status: { in: ["PAID", "FULFILLING", "OUT_FOR_DELIVERY", "DELIVERED"] },
          checkoutAttempt: { state: "PAID" },
          currency: "USD",
          totalCents: { gt: 0 },
        },
        include: {
          checkoutAttempt: { select: { id: true } },
          payments: { include: { events: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return {
        canCreate: Boolean(user.emailVerified && customer.purchaseApprovedAt),
        orders: orders
          .filter((o) =>
            o.payments.some(
              (p) =>
                p.provider === "STRIPE" &&
                p.currency === "USD" &&
                Boolean(p.externalId?.startsWith("pi_")) &&
                p.status === "CAPTURED" &&
                p.amountCents === o.totalCents &&
                p.events.some(
                  (e) =>
                    e.verifiedAt &&
                    e.externalId === `checkout:${o.checkoutAttempt!.id}:paid` &&
                    [
                      "checkout.session.completed",
                      "checkout.session.reconciled",
                    ].includes(e.type),
                ),
            ),
          )
          .map((o) => ({ id: o.id, number: o.number })),
        subscriptions: subscriptions.map((s) => ({
          ...publicSubscription(s),
          orderNumber: s.originOrder?.number ?? null,
          due:
            s.status === "ACTIVE" &&
            s.cadenceMonths === 3 &&
            Boolean(s.nextOrderAt && date(s.nextOrderAt)! <= businessDate()),
          items: s.items.map((i) => ({
            name: `${i.productVariant.product.name} · ${i.productVariant.name}`,
            quantity: i.quantity,
          })),
        })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
