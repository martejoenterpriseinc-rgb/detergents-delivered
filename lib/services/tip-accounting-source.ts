import type { Prisma } from "@prisma/client";
import { AccountError } from "@/lib/domain/account";
import {
  inspectStripeTipRefunds,
  verifyRefundBalanceEvidence,
} from "@/lib/commerce/refund-provider";
const fail = () =>
  new AccountError("Tip accounting requires verified payment evidence.", 409);
export async function tipAccountingSource(tx: Prisma.TransactionClient, tipId: string) {
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
export async function observeTipRefunds(
  tip: Awaited<ReturnType<typeof tipAccountingSource>>["tip"],
) {
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
