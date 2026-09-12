import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import { tipPayoutInput, tipAccounting } from "@/lib/domain/tip-accounting";
import {
  inspectStripeTipRefunds,
  verifyRefundBalanceEvidence,
} from "@/lib/commerce/refund-provider";
import { canonicalJson } from "@/lib/commerce/domain";
import { financeAccess } from "./finance";
const fail = () =>
  new AccountError("Tip accounting requires verified payment evidence.", 409);
async function source(tx: Prisma.TransactionClient, tipId: string) {
  const tip = await tx.deliveryTip.findUnique({ where: { id: tipId } });
  if (
    !tip ||
    tip.state !== "PAID" ||
    !tip.paymentIntentId ||
    !tip.stripeSessionId ||
    !tip.paidAt ||
    tip.currency !== "USD" ||
    tip.taxCents === null ||
    tip.totalCents !== tip.amountCents + tip.taxCents
  )
    throw fail();
  const driver = (tip.source as Record<string, unknown>)?.driverUserId;
  if (typeof driver !== "string" || !driver) throw fail();
  const audit = await tx.auditLog.findMany({
    where: {
      entityType: "DeliveryTip",
      entityId: tip.id,
      action: "delivery.tip.reconciled",
    },
    select: { afterJson: true },
  });
  if (
    !audit.some((a) => {
      const e = a.afterJson as Record<string, unknown> | null;
      return (
        e?.state === "PAID" &&
        e.source === "stripe-api" &&
        e.accountId === tip.stripeAccountId &&
        e.livemode === tip.livemode &&
        e.paymentIntentId === tip.paymentIntentId &&
        e.stripeSessionId === tip.stripeSessionId &&
        e.taxCents === tip.taxCents &&
        e.totalCents === tip.totalCents
      );
    })
  )
    throw fail();
  return { tip, driver };
}
async function observe(tip: Awaited<ReturnType<typeof source>>["tip"]) {
  const observation = await inspectStripeTipRefunds({
    accountId: tip.stripeAccountId,
    live: tip.livemode,
    paymentIntentId: tip.paymentIntentId!,
    checkoutId: tip.id,
    amountCents: tip.totalCents!,
    currency: "USD",
  });
  for (const refund of observation.refunds) {
    if (
      ["failed", "canceled"].includes(refund.status) &&
      refund.failureBalanceTransactionId
    ) {
      await verifyRefundBalanceEvidence(
        {
          accountId: tip.stripeAccountId,
          live: tip.livemode,
          paymentIntentId: tip.paymentIntentId!,
          checkoutId: tip.id,
          amountCents: tip.totalCents!,
          currency: "USD",
        },
        refund,
        true,
      );
    }
  }
  return observation;
}
export async function readTipAccounting(actor: string, tipId: string) {
  await financeAccess(prisma, actor);
  const { tip, driver } = await source(prisma, tipId);
  const observation = await observe(tip);
  const entries = await prisma.tipPayoutEntry.findMany({
    where: { tipId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return {
    tipId,
    driver,
    amountCents: tip.amountCents,
    checkedAt: new Date().toISOString(),
    disputed: observation.disputed,
    ...tipAccounting(tip.amountCents, tip.totalCents!, observation.refunds, entries),
    entries,
    refunds: observation.refunds.map((r) => ({
      id: r.id,
      state: r.status,
      amountCents: r.amountCents,
    })),
  };
}
export async function recordTipPayout(actor: string, raw: unknown) {
  const data = tipPayoutInput.parse(raw);
  await financeAccess(prisma, actor, true);
  const hash = createHash("sha256").update(canonicalJson(data)).digest("hex");
  const id =
    "tip_payout_" +
    createHash("sha256")
      .update(actor + ":" + data.requestKey)
      .digest("hex");
  const previous = await prisma.tipPayoutEntry.findUnique({ where: { id } });
  if (previous) {
    if (previous.requestHash !== hash)
      throw new AccountError("Request key was already used for another transfer.", 409);
    return { id: previous.id };
  }
  const original = await source(prisma, data.tipId);
  const observation = await observe(original.tip);
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    await tx.$queryRaw`SELECT id FROM "DeliveryTip" WHERE id = ${data.tipId} FOR UPDATE`;
    const retry = await tx.tipPayoutEntry.findUnique({ where: { id } });
    if (retry) {
      if (retry.requestHash !== hash)
        throw new AccountError("Request key was already used.", 409);
      return { id };
    }
    const current = await source(tx, data.tipId);
    if (
      current.tip.updatedAt.getTime() !== original.tip.updatedAt.getTime() ||
      current.driver !== original.driver
    )
      throw fail();
    if (data.paidOn < businessDate(current.tip.paidAt!))
      throw new AccountError("Transfer date precedes the tip payment.", 409);
    const entries = await tx.tipPayoutEntry.findMany({ where: { tipId: data.tipId } });
    if (entries.some((entry) => entry.reference === data.reference))
      throw new AccountError(
        "This receipt reference is already recorded for the tip.",
        409,
      );
    const accounting = tipAccounting(
      current.tip.amountCents,
      current.tip.totalCents!,
      observation.refunds,
      entries,
    );
    if (data.reversalOfId) {
      const parent = entries.find(
        (e) => e.id === data.reversalOfId && e.kind === "PAYMENT",
      );
      if (
        !parent ||
        parent.amountCents !== data.amountCents ||
        data.paidOn < parent.paidOn ||
        entries.some((e) => e.reversalOfId === parent.id)
      )
        throw new AccountError(
          "Choose an unreversed transfer and its exact amount.",
          409,
        );
    } else if (
      observation.disputed ||
      accounting.review ||
      data.amountCents > accounting.payableCents
    )
      throw new AccountError(
        "Transfer exceeds the verified amount payable, or the tip needs refund/dispute review.",
        409,
      );
    const entry = {
      id,
      tipId: data.tipId,
      driverUserId: current.driver,
      kind: data.reversalOfId ? "REVERSAL" : "PAYMENT",
      amountCents: data.amountCents,
      reference: data.reference,
      paidOn: data.paidOn,
      reason: data.reason,
      requestHash: hash,
      reversalOfId: data.reversalOfId ?? null,
      actorUserId: actor,
    };
    await tx.tipPayoutEntry.create({ data: entry });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "TipPayoutEntry",
        entityId: id,
        action: "delivery.tip.payout.recorded",
        afterJson: JSON.parse(
          JSON.stringify({
            ...entry,
            source: "staff-confirmed-transfer",
            refundObservation: observation,
            observedAt: new Date().toISOString(),
          }),
        ),
      },
    });
    return { id };
  });
}
