import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { accountIdentity } from "./customer-account";
import { hasPermission, permissionsForRoles } from "@/lib/domain/authz";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "@/lib/commerce/domain";
import {
  inspectStripeRefunds,
  matchProviderRefunds,
} from "@/lib/commerce/refund-provider";

export const refundReviewInput = z
  .object({
    orderId: z.string().min(1).max(100),
    paymentId: z.string().min(1).max(100),
  })
  .strict();

async function snapshot(userId: string, input: z.infer<typeof refundReviewInput>) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const user = await accountIdentity(tx, userId);
      if (
        !hasPermission(
          permissionsForRoles(user.userRoles.map((r) => r.role.code)),
          "orders.read",
        )
      )
        throw new AccountError("Order access required.", 403);
      const payment = await tx.payment.findFirst({
        where: { id: input.paymentId, orderId: input.orderId },
        include: {
          events: { orderBy: { id: "asc" } },
          refunds: { orderBy: { id: "asc" } },
          order: {
            include: {
              checkoutAttempt: {
                select: { id: true, state: true, stripeAccountId: true, livemode: true },
              },
              refundRequests: {
                where: { paymentId: input.paymentId },
                orderBy: { id: "asc" },
              },
            },
          },
        },
      });
      if (!payment) throw new AccountError("Payment not found for this order.", 404);
      const checkout = payment.order.checkoutAttempt;
      if (
        payment.provider !== "STRIPE" ||
        !payment.externalId ||
        !["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status) ||
        !checkout ||
        checkout.state !== "PAID" ||
        payment.amountCents !== payment.order.totalCents ||
        payment.currency !== payment.order.currency ||
        !payment.events.some(
          (e) =>
            e.verifiedAt &&
            e.externalId === `checkout:${checkout.id}:paid` &&
            ["checkout.session.completed", "checkout.session.reconciled"].includes(
              e.type,
            ),
        ) ||
        payment.refunds.some((r) => !r.requestId) ||
        payment.order.refundRequests.some(
          (r) =>
            r.providerAccountId !== checkout.stripeAccountId ||
            r.livemode !== checkout.livemode ||
            r.currency !== payment.currency,
        )
      )
        throw new AccountError("Original payment evidence requires reconciliation.", 409);
      return {
        payment,
        binding: {
          accountId: checkout.stripeAccountId,
          live: checkout.livemode,
          checkoutId: checkout.id,
          paymentIntentId: payment.externalId,
          amountCents: payment.amountCents,
          currency: payment.currency,
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Point-in-time inspection only. Never changes balances, requests, stock or provider state. */
export async function reviewPaymentRefunds(userId: string, raw: unknown) {
  const input = refundReviewInput.parse(raw);
  const before = await snapshot(userId, input);
  // No database transaction remains open during provider I/O.
  const observation = await inspectStripeRefunds(before.binding);
  const requests = before.payment.order.refundRequests;
  const { matched } = matchProviderRefunds(
    observation,
    requests.map((r) => ({
      id: r.id,
      requestHash: r.requestHash,
      providerRefundId: r.providerRefundId,
      submitted: r.submittedAt !== null,
      amountCents: r.amountCents,
      currency: r.currency,
    })),
  );
  // Reject concurrent local changes and revoked access before returning financial data.
  const after = await snapshot(userId, input);
  if (canonicalJson(before) !== canonicalJson(after))
    throw new AccountError("Payment records changed during review. Check again.", 409);
  const sum = (states: readonly string[]) =>
    observation.refunds
      .filter((r) => states.includes(r.status))
      .reduce((total, r) => total + r.amountCents, 0);
  const unresolvedRequests = requests.filter(
    (r) => r.submittedAt && !matched.has(r.id),
  ).length;
  const changedRequests = requests.filter((r) => {
    const provider = matched.get(r.id);
    return provider && provider.status.toUpperCase() !== r.status;
  }).length;
  return {
    checkedAt: new Date().toISOString(),
    currency: observation.currency,
    providerRefundCount: observation.refunds.length,
    succeededCents: sum(["succeeded"]),
    pendingCents: sum(["pending", "requires_action"]),
    failedOrCanceledCents: sum(["failed", "canceled"]),
    disputed: observation.disputed,
    unresolvedRequests,
    changedRequests,
  };
}
