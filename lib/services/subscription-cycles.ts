import { z } from "zod";
import type { Prisma, Subscription } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import {
  subscriptionConsentVersion,
  upcomingQuarter,
  quarterDate,
  subscriptionCycleInput,
} from "@/lib/domain/subscriptions";
import { canonicalJson, heldStates, type CheckoutInput } from "@/lib/commerce/domain";
import { customerIdentity } from "./customer-account";

type Tx = Prisma.TransactionClient;
const cycleSnapshot = z
  .object({
    addressId: z.string().min(1),
    lines: z
      .array(
        z
          .object({
            variantId: z.string().min(1),
            quantity: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Caller holds the customer lock before this subscription lock. */
async function generate(tx: Tx, subscriptionId: string, customerId: string) {
  await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${subscriptionId} FOR UPDATE`;
  const s = await tx.subscription.findFirst({
    where: { id: subscriptionId, customerId },
    include: { items: true },
  });
  if (!s) throw new AccountError("Subscription not found.", 404);
  if (
    s.status !== "ACTIVE" ||
    s.cadenceMonths !== 3 ||
    s.consentVersion !== subscriptionConsentVersion ||
    !s.consentedAt ||
    !s.anchorDate ||
    !s.nextOrderAt ||
    iso(s.nextOrderAt) > businessDate() ||
    iso(s.nextOrderAt) !== quarterDate(iso(s.anchorDate), s.cycleNumber)
  )
    throw new AccountError("This subscription quarter is not due for review.", 409);
  const existing = await tx.subscriptionCycle.findUnique({
    where: {
      subscriptionId_cycleNumber: { subscriptionId: s.id, cycleNumber: s.cycleNumber },
    },
  });
  if (existing) {
    if (existing.state !== "READY")
      throw new AccountError("This quarter has already been resolved.", 409);
    return { id: existing.id };
  }
  const snapshot = cycleSnapshot.parse({
    addressId: s.addressId,
    lines: s.items
      .map((i) => ({ variantId: i.productVariantId, quantity: i.quantity }))
      .sort((a, b) => a.variantId.localeCompare(b.variantId)),
  });
  if (new Set(snapshot.lines.map((l) => l.variantId)).size !== snapshot.lines.length)
    throw new AccountError("Subscription items need review.", 409);
  const cycle = await tx.subscriptionCycle.create({
    data: {
      subscriptionId: s.id,
      cycleNumber: s.cycleNumber,
      scheduledFor: s.nextOrderAt,
      snapshot,
    },
  });
  await tx.auditLog.create({
    data: {
      action: "subscription.cycle.generated",
      entityType: "SubscriptionCycle",
      entityId: cycle.id,
      afterJson: {
        subscriptionId: s.id,
        cycleNumber: s.cycleNumber,
        scheduledFor: iso(s.nextOrderAt),
        billing: "CUSTOMER_REVIEW_REQUIRED",
      },
    },
  });
  return { id: cycle.id };
}
export async function prepareSubscriptionCycle(userId: string, raw: unknown) {
  const { subscriptionId } = subscriptionCycleInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const { customer } = await customerIdentity(tx, userId);
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customer.id} FOR UPDATE`;
    await customerIdentity(tx, userId);
    return generate(tx, subscriptionId, customer.id);
  });
}
export async function generateDueSubscriptionCycles(ownsLease: () => Promise<boolean>) {
  const due = await prisma.$queryRaw<{ id: string; customerId: string }[]>`
    SELECT s.id, s."customerId" FROM "Subscription" s
    JOIN "Customer" c ON c.id = s."customerId"
    JOIN "User" u ON u.id = c."userId"
    WHERE s.status = 'ACTIVE' AND s."cadenceMonths" = 3
      AND s."consentVersion" = ${subscriptionConsentVersion}
      AND s."nextOrderAt" <= ${new Date(businessDate())}
      AND c."deletedAt" IS NULL AND u."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "SubscriptionCycle" sc
        WHERE sc."subscriptionId" = s.id AND sc."cycleNumber" = s."cycleNumber")
    ORDER BY s."nextOrderAt", s.id LIMIT 100`;
  let completed = 0,
    attention = 0;
  for (const s of due) {
    if (!(await ownsLease())) throw new Error("Worker lease expired.");
    // A due quarter stays visible until the household pays or skips it. Never catch up charges.
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${s.customerId} FOR UPDATE`;
        const c = await tx.customer.findFirst({
          where: { id: s.customerId, deletedAt: null, user: { deletedAt: null } },
        });
        if (!c) return;
        await generate(tx, s.id, s.customerId);
      });
      completed++;
    } catch {
      attention++;
    }
  }
  return { checked: due.length, completed, attention };
}
/** Read only, also called again under the customer lock after provider quote I/O. */
export async function validateSubscriptionCheckout(
  tx: Tx,
  customerId: string,
  input: CheckoutInput,
) {
  if (!input.subscriptionCycleId) return;
  const c = await tx.subscriptionCycle.findFirst({
    where: { id: input.subscriptionCycleId, subscription: { customerId } },
    include: { subscription: true },
  });
  const s = c?.subscription;
  if (!c || !s) throw new AccountError("Subscription quarter not found.", 404);
  if (
    c.state !== "READY" ||
    s.status !== "ACTIVE" ||
    s.cadenceMonths !== 3 ||
    s.consentVersion !== subscriptionConsentVersion ||
    !s.consentedAt ||
    s.cycleNumber !== c.cycleNumber ||
    iso(c.scheduledFor) > businessDate()
  )
    throw new AccountError("This quarter is no longer available for checkout.", 409);
  const snapshot = cycleSnapshot.parse(c.snapshot);
  const lines = [...input.lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
  if (
    snapshot.addressId !== input.addressId ||
    canonicalJson(snapshot.lines) !== canonicalJson(lines)
  )
    throw new AccountError("Checkout must match the saved subscription quarter.", 409);
}
/** Customer lock serializes quote attachment, lifecycle controls and checkout settlement. */
export async function attachSubscriptionQuote(
  tx: Tx,
  customerId: string,
  input: CheckoutInput,
) {
  if (!input.subscriptionCycleId) return;
  await validateSubscriptionCheckout(tx, customerId, input);
  const other = await tx.checkoutAttempt.findMany({
    where: {
      subscriptionCycleId: input.subscriptionCycleId,
      requestKey: { not: input.requestKey },
      state: { notIn: ["EXPIRED"] },
    },
  });
  if (other.some((a) => a.state !== "QUOTED" || a.expiresAt > new Date()))
    throw new AccountError(
      "Finish or cancel this quarter's existing checkout before reviewing again.",
      409,
    );
  // Quotes have no money or inventory hold. Provider-owned sessions are never expired here.
  await tx.checkoutAttempt.updateMany({
    where: {
      subscriptionCycleId: input.subscriptionCycleId,
      state: "QUOTED",
      expiresAt: { lte: new Date() },
    },
    data: { state: "EXPIRED" },
  });
}
export async function changeSubscriptionCycles(tx: Tx, s: Subscription, action: string) {
  const held = await tx.checkoutAttempt.count({
    where: { subscriptionCycle: { subscriptionId: s.id }, state: { in: heldStates } },
  });
  if (held && ["skip", "resume"].includes(action))
    throw new AccountError(
      "Resolve the current subscription checkout before changing its quarter.",
      409,
    );
  if (held) return; // Pause/cancel stop future purchases; an in-progress payment still reconciles.
  await tx.checkoutAttempt.updateMany({
    where: {
      subscriptionCycle: { subscriptionId: s.id, state: "READY" },
      state: "QUOTED",
    },
    data: { state: "EXPIRED" },
  });
  await tx.subscriptionCycle.updateMany({
    where: { subscriptionId: s.id, state: "READY" },
    data: { state: action === "cancel" ? "CANCELED" : "SKIPPED" },
  });
}
export async function settleSubscriptionCycle(
  tx: Tx,
  checkoutId: string,
  customerId: string,
  cycleId: string | null,
) {
  if (!cycleId) return;
  const c = await tx.subscriptionCycle.findFirst({
    where: { id: cycleId, subscription: { customerId } },
    include: { subscription: true },
  });
  if (!c) throw new Error("Subscription payment binding is missing.");
  if (c.state === "PAID" && c.paidCheckoutId === checkoutId) return;
  if (c.state !== "READY") throw new Error("Subscription quarter already resolved.");
  const s = c.subscription;
  if (s.cycleNumber !== c.cycleNumber || !s.anchorDate)
    throw new Error("Subscription payment quarter changed.");
  await tx.subscriptionCycle.update({
    where: { id: c.id },
    data: { state: "PAID", paidCheckoutId: checkoutId },
  });
  if (s.status !== "CANCELLED") {
    const next = upcomingQuarter(iso(s.anchorDate), s.cycleNumber + 1, businessDate());
    await tx.subscription.update({
      where: { id: s.id },
      data: {
        cycleNumber: next.cycle,
        nextOrderAt: new Date(next.date),
        version: { increment: 1 },
      },
    });
  }
  await tx.auditLog.create({
    data: {
      action: "subscription.cycle.paid",
      entityType: "SubscriptionCycle",
      entityId: c.id,
      afterJson: { subscriptionId: s.id, checkoutId, cycleNumber: c.cycleNumber },
    },
  });
}
export async function readSubscriptionCycle(userId: string, id: string) {
  const { customer } = await customerIdentity(prisma, userId);
  const c = await prisma.subscriptionCycle.findFirst({
    where: { id, subscription: { customerId: customer.id } },
    include: {
      subscription: { include: { address: true } },
      attempts: {
        where: { state: { notIn: ["EXPIRED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!c) throw new AccountError("Subscription quarter not found.", 404);
  const snapshot = cycleSnapshot.parse(c.snapshot);
  const products = await prisma.productVariant.findMany({
    where: { id: { in: snapshot.lines.map((l) => l.variantId) } },
    include: { product: { select: { name: true } } },
  });
  const a = c.subscription.address;
  return {
    id: c.id,
    state: c.state,
    scheduledFor: iso(c.scheduledFor),
    ready: c.state === "READY" && c.subscription.status === "ACTIVE",
    checkoutId: c.attempts[0]?.id ?? null,
    addresses:
      a && a.id === snapshot.addressId
        ? [{ id: a.id, label: `${a.line1}, ${a.city} ${a.postalCode}` }]
        : [],
    lines: snapshot.lines.map((l) => ({
      ...l,
      productName:
        products.find((p) => p.id === l.variantId)?.product.name ?? "Saved product",
      unitPriceCents: 0,
    })),
  };
}
