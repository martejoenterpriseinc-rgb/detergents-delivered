import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { rewardAllocation } from "@/lib/domain/loyalty";
import { customerIdentity } from "./customer-account";
import { loyaltyAdmin, programConfig, rewardBalance } from "./loyalty";

type Tx = Prisma.TransactionClient;
async function lockWallet(tx: Tx, customerId: string) {
  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
}
async function entry(
  tx: Tx,
  data: Prisma.RewardEntryUncheckedCreateInput,
  actorUserId?: string,
) {
  const saved = await tx.rewardEntry.create({ data });
  await tx.auditLog.create({
    data: {
      actorUserId,
      action: "rewards.entry.created",
      entityType: "RewardEntry",
      entityId: saved.id,
      afterJson: {
        kind: saved.kind,
        amountCents: saved.amountCents,
        sourceId: saved.sourceId,
      },
    },
  });
  return saved;
}
// This requires persisted, signature-verified provider evidence. It never accepts a browser success flag.
async function capturedPayment(tx: Tx, orderId: string) {
  const payments = await tx.payment.findMany({
    where: { orderId, status: "CAPTURED", provider: "STRIPE", currency: "USD" },
    include: { events: true },
  });
  const trusted = payments.filter(
    (p) =>
      p.externalId &&
      p.events.some(
        (e) =>
          e.verifiedAt &&
          e.externalId &&
          [
            "payment_intent.succeeded",
            "checkout.session.completed",
            "checkout.session.reconciled",
          ].includes(e.type),
      ),
  );
  return trusted.reduce((sum, p) => sum + p.amountCents, 0);
}
export async function reviewReferral(userId: string, referralId: string) {
  return prisma.$transaction(async (tx) => {
    await loyaltyAdmin(tx, userId);
    const original = await tx.referral.findUnique({ where: { id: referralId } });
    if (!original?.linkId)
      throw new AccountError("This referral has no supported program snapshot.", 409);
    for (const id of [original.referrerId, original.refereeId].sort())
      await lockWallet(tx, id);
    await tx.$queryRaw`SELECT id FROM "Referral" WHERE id = ${referralId} FOR UPDATE`;
    const referral = await tx.referral.findUniqueOrThrow({ where: { id: referralId } });
    if (referral.status === "REVERSED") return { status: "REVERSED" };
    const config = await programConfig(tx);
    if (referral.status === "PENDING" && !config.enabled)
      throw new AccountError("The referral program is paused.", 409);
    const customers = await tx.customer.findMany({
      where: {
        id: { in: [referral.referrerId, referral.refereeId] },
        deletedAt: null,
        user: { deletedAt: null, emailVerified: { not: null } },
      },
    });
    if (
      referral.status === "PENDING" &&
      (customers.length !== 2 ||
        (customers[0].phone && customers[0].phone === customers[1].phone))
    )
      throw new AccountError(
        "Both accounts need verified, distinct eligible identities.",
        409,
      );
    const candidate = referral.qualifyingOrderId
      ? await tx.order.findUnique({ where: { id: referral.qualifyingOrderId } })
      : await tx.order.findFirst({
          where: {
            customerId: referral.refereeId,
            status: { notIn: ["DRAFT", "PENDING_PAYMENT", "CANCELLED"] },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
    if (!candidate)
      throw new AccountError("No qualifying paid first order is available.", 409);
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${candidate.id} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: candidate.id },
      include: { refunds: true, payments: true },
    });
    const refunded =
      order.refunds.length > 0 ||
      ["REFUNDED", "CANCELLED"].includes(order.status) ||
      order.payments.some((p) => ["REFUNDED", "PARTIALLY_REFUNDED"].includes(p.status));
    if (referral.status === "REWARDED") {
      if (!refunded) return { status: "REWARDED" };
      // Append compensating credits, never erase an award or a historical spend.
      for (const [customerId, amountCents, suffix] of [
        [referral.referrerId, referral.creditCents, "referrer"],
        [referral.refereeId, referral.friendCreditCents, "friend"],
      ] as const) {
        if (amountCents)
          await entry(
            tx,
            {
              customerId,
              amountCents: -amountCents,
              kind: "REVERSAL",
              entryKey: `referral:${referral.id}:reverse:${suffix}`,
              sourceId: referral.id,
              orderId: order.id,
              description: "Referral reward reversed after refund or cancellation",
            },
            userId,
          );
      }
      await tx.referral.update({
        where: { id: referral.id },
        data: { status: "REVERSED", reversedAt: new Date() },
      });
      return { status: "REVERSED" };
    }
    if (
      refunded ||
      order.currency !== "USD" ||
      order.totalCents <= 0 ||
      order.createdAt < referral.createdAt ||
      order.subtotalCents - order.discountCents < referral.minimumPurchaseCents ||
      !["PAID", "FULFILLING", "OUT_FOR_DELIVERY", "DELIVERED"].includes(order.status)
    )
      throw new AccountError(
        "The first order does not meet the referral purchase rules.",
        409,
      );
    if ((await capturedPayment(tx, order.id)) !== order.totalCents)
      throw new AccountError(
        "Verified payment evidence is required. Payment integration is not connected yet.",
        409,
      );
    if (
      (await tx.referral.count({
        where: {
          referrerId: referral.referrerId,
          status: { in: ["REWARDED", "REVERSED"] },
        },
      })) >= config.maxReferralsPerCustomer
    )
      throw new AccountError("The referral reward limit has been reached.", 409);
    for (const [customerId, amountCents, suffix] of [
      [referral.referrerId, referral.creditCents, "referrer"],
      [referral.refereeId, referral.friendCreditCents, "friend"],
    ] as const) {
      if (amountCents)
        await entry(
          tx,
          {
            customerId,
            amountCents,
            kind: "REFERRAL",
            entryKey: `referral:${referral.id}:${suffix}`,
            sourceId: referral.id,
            orderId: order.id,
            description:
              suffix === "friend"
                ? "First-purchase referral reward"
                : "Reward for a qualifying referral purchase",
          },
          userId,
        );
    }
    await tx.referral.update({
      where: { id: referral.id },
      data: { status: "REWARDED", qualifyingOrderId: order.id, redeemedAt: new Date() },
    });
    return { status: "REWARDED" };
  });
}

/** Internal checkout boundary only: no HTTP endpoint exposes a hold or spend until payment/tax/stock/capacity finalization is connected. */
export async function reserveOrderRewards(
  tx: Tx,
  userId: string,
  orderId: string,
  requestKey: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(requestKey))
    throw new AccountError("Invalid request key.");
  const { user, customer } = await customerIdentity(tx, userId);
  if (!user.emailVerified) throw new AccountError("Verified account required.", 403);
  await lockWallet(tx, customer.id);
  const priorKey = await tx.rewardReservation.findUnique({
    where: { customerId_requestKey: { customerId: customer.id, requestKey } },
  });
  if (priorKey && priorKey.orderId !== orderId)
    throw new AccountError("Request key belongs to another order.", 409);
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.order.findFirst({
    where: { id: orderId, customerId: customer.id },
  });
  if (!order) throw new AccountError("Order not found.", 404);
  const prior = await tx.rewardReservation.findUnique({ where: { orderId } });
  if (prior) {
    if (
      prior.requestKey !== requestKey ||
      prior.orderTotalCents !== order.totalCents ||
      prior.state === "RELEASED"
    )
      throw new AccountError("Checkout changed; start a new checkout.", 409);
    return prior;
  }
  if (
    order.status !== "PENDING_PAYMENT" ||
    order.currency !== "USD" ||
    order.totalCents < 0 ||
    (await tx.payment.count({
      where: { orderId, status: { in: ["PENDING", "AUTHORIZED", "CAPTURED"] } },
    }))
  )
    throw new AccountError("Rewards must be reserved before starting payment.", 409);
  const balance = await rewardBalance(tx, customer.id);
  const { appliedCents } = rewardAllocation(balance.availableCents, order.totalCents);
  if (!appliedCents)
    throw new AccountError("No rewards are available for this order.", 409);
  const reservation = await tx.rewardReservation.create({
    data: {
      orderId,
      customerId: customer.id,
      requestKey,
      amountCents: appliedCents,
      orderTotalCents: order.totalCents,
    },
  });
  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      action: "rewards.reserved",
      entityType: "RewardReservation",
      entityId: reservation.id,
      afterJson: { amountCents: appliedCents, orderId },
    },
  });
  return reservation;
}
/** Call INSIDE the trusted checkout finalization transaction together with stock/capacity/order/receipt writes. */
export async function commitOrderRewards(tx: Tx, orderId: string) {
  const initial = await tx.rewardReservation.findUnique({ where: { orderId } });
  if (!initial) throw new AccountError("Reward reservation missing.", 409);
  await lockWallet(tx, initial.customerId);
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  const hold = await tx.rewardReservation.findUniqueOrThrow({ where: { orderId } });
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (
    hold.state === "RELEASED" ||
    hold.orderTotalCents !== order.totalCents ||
    hold.customerId !== order.customerId
  )
    throw new AccountError("Reward reservation no longer matches this order.", 409);
  if (hold.state === "HELD") {
    if (
      order.status !== "PENDING_PAYMENT" ||
      order.currency !== "USD" ||
      (await capturedPayment(tx, orderId)) + hold.amountCents !== order.totalCents ||
      (await tx.refund.count({ where: { orderId } }))
    )
      throw new AccountError(
        "Confirmed payment and unchanged checkout are required.",
        409,
      );
    // A reversal during payment may require reconciliation; never overspend the wallet.
    const balance = await rewardBalance(tx, hold.customerId);
    if (balance.balanceCents < balance.heldCents)
      throw new AccountError(
        "Rewards changed during payment; checkout needs reconciliation.",
        409,
      );
    await entry(tx, {
      customerId: hold.customerId,
      amountCents: -hold.amountCents,
      kind: "REDEMPTION",
      entryKey: `order:${orderId}:use`,
      sourceId: hold.id,
      orderId,
      description: `Rewards used on order ${order.number}`,
    });
    await tx.rewardReservation.update({
      where: { id: hold.id },
      data: { state: "USED" },
    });
  }
  const balance = await rewardBalance(tx, hold.customerId);
  return {
    usedCents: hold.amountCents,
    remainingCents: balance.availableCents,
    orderNumber: order.number,
    confirmed: true as const,
  };
}
export async function releaseOrderRewards(tx: Tx, orderId: string) {
  const initial = await tx.rewardReservation.findUnique({ where: { orderId } });
  if (!initial) return;
  await lockWallet(tx, initial.customerId);
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  const hold = await tx.rewardReservation.findUniqueOrThrow({ where: { orderId } });
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (hold.state === "RELEASED") return;
  if (
    hold.state !== "HELD" ||
    order.status !== "CANCELLED" ||
    (await tx.payment.count({
      where: { orderId, status: { in: ["PENDING", "AUTHORIZED", "CAPTURED"] } },
    }))
  )
    throw new AccountError("Cancel and reconcile payment before releasing rewards.", 409);
  await tx.rewardReservation.update({
    where: { id: hold.id },
    data: { state: "RELEASED" },
  });
  await tx.auditLog.create({
    data: {
      action: "rewards.released",
      entityType: "RewardReservation",
      entityId: hold.id,
    },
  });
}
