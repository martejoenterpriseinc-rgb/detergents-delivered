import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { hasPermission, permissionsForRoles } from "@/lib/domain/authz";
import {
  allocateRemainingRefundLine,
  assertRefundCapacity,
  refundRequestInput,
  stockReturnInput,
  cancelRefundInput,
} from "@/lib/domain/refund-allocation";
import { canonicalJson } from "@/lib/commerce/domain";
import { readCommerce } from "@/lib/commerce/runtime";
import { accountIdentity } from "@/lib/services/customer-account";
import { persistInventoryTransaction } from "@/lib/services/inventory-ledger";
import {
  submitClaimedStripeRefund,
  inspectStripeRefunds,
  matchProviderRefunds,
  verifyRefundBalanceEvidence,
} from "@/lib/commerce/refund-provider";

import { refundRewardAmounts } from "./refund-rewards";
import { refundTransition, effectiveRefundCents } from "@/lib/domain/refund-settlement";
import { reviewReferralInTransaction } from "./reward-ledger";
type Tx = Prisma.TransactionClient;
const submissionInput = z
  .object({
    orderId: z.string().min(1).max(100),
    requestId: z.string().min(1).max(100),
  })
  .strict();
const providerObservation = z
  .object({
    id: z.string().min(1).max(255),
    amountCents: z.number().int().positive().max(100_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]),
    created: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    requestId: z.string().min(1).max(100),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    project: z.literal("detergents-delivered"),
    balanceTransactionId: z.string().min(1).max(255).nullable(),
    failureBalanceTransactionId: z.string().min(1).max(255).nullable(),
  })
  .strict();
const submissionResultInput = submissionInput
  .extend({ observation: providerObservation.nullable() })
  .strict();
const reservedRefundStates = [
  "PREPARED",
  "SUBMITTING",
  "UNKNOWN",
  "PENDING",
  "REQUIRES_ACTION",
  "SUCCEEDED",
] as const;

async function refundAccess(tx: Tx, userId: string) {
  const user = await accountIdentity(tx, userId);
  const permissions = permissionsForRoles(user.userRoles.map(({ role }) => role.code));
  if (!hasPermission(permissions, "orders.write"))
    throw new AccountError("Order management access required.", 403);
}

async function validatedPreparedRefund(
  tx: Tx,
  input: z.infer<typeof submissionInput>,
  commerce: Pick<Awaited<ReturnType<typeof readCommerce>>, "accountId" | "live">,
  rewardOnly = false,
) {
  const request = await tx.refundRequest.findUnique({
    where: { id: input.requestId },
    include: {
      lines: true,
      payment: {
        include: {
          events: true,
          refunds: { include: { request: { include: { adjustments: true } } } },
        },
      },
      order: {
        include: {
          items: true,
          checkoutAttempt: true,
          rewardReservation: true,
          refundRequests: { include: { lines: true } },
        },
      },
    },
  });
  if (!request || request.orderId !== input.orderId)
    throw new AccountError("Refund request not found.", 404);
  // Includes failed/canceled attempts: only reconciliation may resolve a prior submission.
  if (request.submittedAt || request.providerRefundId || request.status !== "PREPARED")
    throw new AccountError(
      "This refund cannot be submitted again. Review its existing outcome.",
      409,
    );
  const { payment, order } = request;
  const checkout = order.checkoutAttempt;
  if (
    !checkout ||
    checkout.state !== "PAID" ||
    request.providerAccountId !== commerce.accountId ||
    request.livemode !== commerce.live ||
    checkout.stripeAccountId !== request.providerAccountId ||
    checkout.livemode !== request.livemode ||
    payment.orderId !== order.id ||
    payment.provider !== "STRIPE" ||
    !(
      rewardOnly
        ? ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"]
        : ["CAPTURED", "PARTIALLY_REFUNDED"]
    ).includes(payment.status) ||
    !payment.externalId?.startsWith("pi_") ||
    payment.amountCents !== order.totalCents ||
    payment.currency !== order.currency ||
    request.currency !== payment.currency ||
    (rewardOnly && request.currency !== "USD") ||
    !(
      rewardOnly
        ? ["PAID", "FULFILLING", "OUT_FOR_DELIVERY", "DELIVERED", "REFUNDED"]
        : ["PAID", "FULFILLING", "OUT_FOR_DELIVERY", "DELIVERED"]
    ).includes(order.status) ||
    payment.refunds.some((r) => !r.requestId) ||
    !payment.events.some(
      (e) =>
        e.verifiedAt &&
        e.externalId === `checkout:${checkout.id}:paid` &&
        ["checkout.session.completed", "checkout.session.reconciled"].includes(e.type),
    )
  )
    throw new AccountError("Original payment and refund evidence requires review.", 409);
  const rewardAmounts = await refundRewardAmounts(tx, order.id);
  const originalInput = refundRequestInput.parse({
    requestKey: request.requestKey,
    orderId: request.orderId,
    paymentId: request.paymentId,
    reason: request.reason,
    lines: request.lines
      .map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity }))
      .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
  });
  if (
    fingerprint(originalInput) !== request.requestHash ||
    (rewardOnly
      ? request.amountCents !== 0 || !request.lines.some((l) => l.rewardCents > 0)
      : request.amountCents <= 0) ||
    request.lines.some((l) => l.rewardCents < 0 || l.netCents < 0 || l.taxCents < 0) ||
    request.lines.reduce((total, l) => total + l.netCents + l.taxCents, 0) !==
      request.amountCents
  )
    throw new AccountError("Saved refund allocation requires review.", 409);
  const active = order.refundRequests.filter((r) =>
    reservedRefundStates.includes(r.status as (typeof reservedRefundStates)[number]),
  );
  if (
    active.some(
      (r) =>
        r.id !== request.id &&
        ["SUBMITTING", "UNKNOWN", "PENDING", "REQUIRES_ACTION"].includes(r.status),
    )
  )
    throw new AccountError(
      "Resolve the existing refund attempt before submitting another.",
      409,
    );
  for (const line of request.lines) {
    const item = order.items.find((i) => i.id === line.orderItemId);
    const held = active
      .flatMap((r) => r.lines)
      .filter((l) => l.orderItemId === line.orderItemId);
    if (
      !item ||
      held.reduce((s, l) => s + l.quantity, 0) > item.quantity ||
      held.reduce((s, l) => s + l.netCents, 0) > item.lineTotalCents - item.taxCents ||
      held.reduce((s, l) => s + l.taxCents, 0) > item.taxCents ||
      held.reduce((s, l) => s + l.rewardCents, 0) > (rewardAmounts.get(item.id) ?? 0)
    )
      throw new AccountError("Refund exceeds the purchased item allocation.", 409);
  }
  if (!rewardOnly)
    assertRefundCapacity({
      capturedCents: payment.amountCents,
      settledCents: payment.refunds.reduce((s, r) => s + effectiveRefundCents(r), 0),
      unresolvedCents: active
        .filter((r) => r.id !== request.id && r.status !== "SUCCEEDED")
        .reduce((s, r) => s + r.amountCents, 0),
      requestedCents: request.amountCents,
    });
  return { request, payment, order, checkout };
}

/** Durable internal submission boundary; staff access is guarded by the cash operation wrapper. */
export async function claimRefundSubmission(userId: string, raw: unknown) {
  const input = submissionInput.parse(raw);
  await refundAccess(prisma, userId);
  const commerce = await readCommerce(true);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    await refundAccess(tx, userId);
    const { request, payment, order, checkout } = await validatedPreparedRefund(
      tx,
      input,
      commerce,
    );
    const submittedAt = new Date();
    await tx.refundRequest.update({
      where: { id: request.id },
      data: {
        status: "SUBMITTING",
        submittedAt,
        lastError: null,
      },
    });
    await tx.refundRequestEvent.create({
      data: {
        refundRequestId: request.id,
        type: "refund.submission.claimed",
        status: "SUBMITTING",
        evidenceJson: { actorUserId: userId },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "refund.submission.claimed",
        entityType: "RefundRequest",
        entityId: request.id,
        beforeJson: { status: "PREPARED" },
        afterJson: {
          status: "SUBMITTING",
          amountCents: request.amountCents,
          currency: request.currency,
        },
      },
    });
    // Internal envelope only; never return provider bindings to a browser.
    return {
      requestId: request.id,
      otherRequests: order.refundRequests
        .filter((r) => r.id !== request.id)
        .map((r) => ({
          id: r.id,
          requestHash: r.requestHash,
          providerRefundId: r.providerRefundId,
          submitted: r.submittedAt !== null,
          amountCents: r.amountCents,
          currency: r.currency,
        })),
      requestHash: request.requestHash,
      amountCents: request.amountCents,
      submittedAt: submittedAt.toISOString(),
      binding: {
        accountId: request.providerAccountId,
        live: request.livemode,
        checkoutId: checkout.id,
        paymentIntentId: payment.externalId!,
        amountCents: payment.amountCents,
        currency: payment.currency,
      },
    };
  });
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Internal receipt persistence, not settlement. Accept only the server adapter's
 * minimal observation, or null for an uncertain result. Never expose as a client API.
 */
export async function recordRefundSubmissionResult(userId: string, raw: unknown) {
  const input = submissionResultInput.parse(raw);
  await refundAccess(prisma, userId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    await refundAccess(tx, userId);
    return persistSubmissionResult(tx, userId, input);
  });
}

async function persistSubmissionResult(
  tx: Tx,
  userId: string,
  input: z.infer<typeof submissionResultInput>,
) {
  const request = await tx.refundRequest.findUnique({ where: { id: input.requestId } });
  if (!request || request.orderId !== input.orderId)
    throw new AccountError("Refund request not found.", 404);
  if (!request.submittedAt || !["SUBMITTING", "UNKNOWN"].includes(request.status))
    throw new AccountError("This request is not awaiting a submission outcome.", 409);
  const observed = input.observation;
  if (
    observed &&
    (observed.requestId !== request.id ||
      observed.requestHash !== request.requestHash ||
      observed.amountCents !== request.amountCents ||
      observed.currency !== request.currency ||
      (request.providerRefundId && request.providerRefundId !== observed.id))
  )
    throw new AccountError("Refund response does not match the saved request.", 409);
  // A delayed timeout cannot erase a receipt already recorded by another caller.
  if (!observed && request.providerRefundId) return publicRefundRequest(request);
  const evidence = observed
    ? {
        providerRefundId: observed.id,
        providerStatus: observed.status,
        amountCents: observed.amountCents,
        currency: observed.currency,
        created: observed.created,
        balanceTransactionId: observed.balanceTransactionId,
        failureBalanceTransactionId: observed.failureBalanceTransactionId,
      }
    : { outcome: "unconfirmed" };
  const eventKey = `dd:refund:receipt:${request.id}:${fingerprint(evidence)}`;
  const prior = await tx.refundRequestEvent.findUnique({
    where: { providerEventId: eventKey },
  });
  if (prior) return publicRefundRequest(request);
  const saved = await tx.refundRequest.update({
    where: { id: request.id },
    data: {
      status: "UNKNOWN",
      ...(observed ? { providerRefundId: observed.id } : {}),
      lastError: observed
        ? "Provider response recorded; settlement reconciliation required."
        : "Submission outcome is unconfirmed; do not submit again.",
    },
  });
  await tx.refundRequestEvent.create({
    data: {
      refundRequestId: request.id,
      providerEventId: eventKey,
      type: observed ? "refund.submission.observed" : "refund.submission.unconfirmed",
      status: "UNKNOWN",
      evidenceJson: evidence,
      // This is receipt time, not a claim that money/tax/rewards have settled.
      verifiedAt: observed ? new Date() : null,
    },
  });
  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      action: "refund.submission.outcome-recorded",
      entityType: "RefundRequest",
      entityId: request.id,
      beforeJson: { status: request.status },
      afterJson: {
        status: "UNKNOWN",
        providerStatus: observed?.status ?? "unconfirmed",
        amountCents: request.amountCents,
      },
    },
  });
  return publicRefundRequest(saved);
}

/** Internal orchestration; the staff wrapper requires explicit account-bound activation. */
export async function submitPreparedRefund(userId: string, raw: unknown) {
  const input = submissionInput.parse(raw);
  const { otherRequests, ...claim } = await claimRefundSubmission(userId, input);
  let observation;
  try {
    await refundAccess(prisma, userId);
    observation = await submitClaimedStripeRefund(claim, otherRequests);
  } catch {
    // Never expose raw provider failures, retry creation or release the durable claim.
    return recordRefundSubmissionResult(userId, { ...input, observation: null });
  }
  // Persistence failure after a provider response leaves the claim for recovery.
  // Do not catch it and attempt a second provider submission.
  return recordRefundSubmissionResult(userId, { ...input, observation });
}

async function recoverySnapshot(
  tx: Tx,
  userId: string,
  input: z.infer<typeof submissionInput>,
  settlement = false,
) {
  await refundAccess(tx, userId);
  const request = await tx.refundRequest.findUnique({
    where: { id: input.requestId },
    include: {
      lines: { orderBy: { id: "asc" } },
      adjustments: { orderBy: { id: "asc" } },
      payment: {
        include: {
          events: { orderBy: { id: "asc" } },
          refunds: {
            orderBy: { id: "asc" },
            include: {
              request: { include: { adjustments: { orderBy: { id: "asc" } } } },
            },
          },
        },
      },
      order: {
        include: {
          checkoutAttempt: true,
          rewardReservation: true,
          qualifyingReferral: true,
          items: { orderBy: { id: "asc" } },
          refundRequests: {
            orderBy: { id: "asc" },
            include: { lines: { orderBy: { id: "asc" } } },
          },
        },
      },
    },
  });
  if (!request || request.orderId !== input.orderId)
    throw new AccountError("Refund request not found.", 404);
  if (
    !request.submittedAt ||
    (settlement
      ? request.status === "PREPARED"
      : !["SUBMITTING", "UNKNOWN"].includes(request.status))
  )
    throw new AccountError("This request is not awaiting a submission outcome.", 409);
  const { payment, order } = request;
  const checkout = order.checkoutAttempt;
  if (
    !checkout ||
    checkout.state !== "PAID" ||
    payment.orderId !== order.id ||
    payment.provider !== "STRIPE" ||
    !payment.externalId ||
    !["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status) ||
    payment.amountCents !== order.totalCents ||
    payment.currency !== order.currency ||
    request.currency !== payment.currency ||
    request.providerAccountId !== checkout.stripeAccountId ||
    request.livemode !== checkout.livemode ||
    payment.refunds.some((r) => !r.requestId) ||
    order.refundRequests.some(
      (r) =>
        r.paymentId === payment.id &&
        (r.providerAccountId !== checkout.stripeAccountId ||
          r.livemode !== checkout.livemode ||
          r.currency !== payment.currency),
    ) ||
    !payment.events.some(
      (e) =>
        e.verifiedAt &&
        e.externalId === `checkout:${checkout.id}:paid` &&
        ["checkout.session.completed", "checkout.session.reconciled"].includes(e.type),
    )
  )
    throw new AccountError("Original payment evidence requires reconciliation.", 409);
  return {
    request,
    binding: {
      accountId: checkout.stripeAccountId,
      live: checkout.livemode,
      checkoutId: checkout.id,
      paymentIntentId: payment.externalId!,
      amountCents: payment.amountCents,
      currency: payment.currency,
    },
  };
}

/** Recover a lost receipt using provider reads only. Never retries refund creation
 * or settles money. Internal only until the complete refund workflow is accepted.
 */
export async function recoverRefundSubmission(userId: string, raw: unknown) {
  const input = submissionInput.parse(raw);
  const before = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return recoverySnapshot(tx, userId, input);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  let observation;
  try {
    // The adapter verifies the original payment/account/mode and complete history.
    // No transaction or database lock is held during network I/O.
    observation = await inspectStripeRefunds(before.binding);
  } catch {
    throw new AccountError(
      "Refund lookup could not be verified. The existing request remains reserved.",
      409,
    );
  }
  const expected = before.request.order.refundRequests
    .filter((r) => r.paymentId === before.request.paymentId)
    .map((r) => ({
      id: r.id,
      requestHash: r.requestHash,
      providerRefundId: r.providerRefundId,
      submitted: r.submittedAt !== null,
      amountCents: r.amountCents,
      currency: r.currency,
    }));
  const { matched } = matchProviderRefunds(observation, expected);
  const result = submissionResultInput.parse({
    ...input,
    observation: matched.get(input.requestId) ?? null,
  });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const after = await recoverySnapshot(tx, userId, input);
    if (canonicalJson(before) !== canonicalJson(after))
      throw new AccountError(
        "Payment records changed during recovery. Check again.",
        409,
      );
    // Validation and receipt/audit writes share one lock and transaction.
    // Missing evidence is uncertainty, never permission to release or resubmit.
    return persistSubmissionResult(tx, userId, result);
  });
}

/** Verified settlement boundary used by staff reconciliation. No provider writes. */
export async function reconcileRefundSettlement(userId: string, raw: unknown) {
  const input = submissionInput.parse(raw);
  const before = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return recoverySnapshot(tx, userId, input, true);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const provider = await inspectStripeRefunds(before.binding).catch(() => {
    throw new AccountError(
      "Refund lookup could not be verified. No accounting changed.",
      409,
    );
  });
  const requests = before.request.order.refundRequests.filter(
    (r) => r.paymentId === before.request.paymentId,
  );
  const { matched } = matchProviderRefunds(
    provider,
    requests.map((r) => ({
      id: r.id,
      requestHash: r.requestHash,
      providerRefundId: r.providerRefundId,
      submitted: r.submittedAt !== null,
      amountCents: r.amountCents,
      currency: r.currency,
    })),
  );
  const found = matched.get(input.requestId);
  if (!found || provider.disputed)
    throw new AccountError("Refund evidence needs review; reservation retained.", 409);
  const observed = providerObservation.parse(found);
  const transition = refundTransition(before.request.status, observed.status);
  await verifyRefundBalanceEvidence(before.binding, found, transition.compensate).catch(
    () => {
      throw new AccountError(
        "Returned refund funds could not be verified. No accounting changed.",
        409,
      );
    },
  );
  return prisma.$transaction(async (tx) => {
    // Checkout and referral operations lock wallets before orders. Keep that order.
    const referral = before.request.order.qualifyingReferral;
    const wallets = [
      ...new Set([
        before.request.order.customerId,
        ...(referral ? [referral.referrerId, referral.refereeId] : []),
      ]),
    ].sort();
    for (const id of wallets)
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${id} FOR UPDATE`;
    if (referral)
      await tx.$queryRaw`SELECT id FROM "Referral" WHERE id = ${referral.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const after = await recoverySnapshot(tx, userId, input, true);
    if (canonicalJson(before) !== canonicalJson(after))
      throw new AccountError(
        "Payment records changed during settlement. Check again.",
        409,
      );
    const request = after.request;
    const totals = request.lines.reduce(
      (s, l) => ({
        net: s.net + l.netCents,
        tax: s.tax + l.taxCents,
        rewards: s.rewards + l.rewardCents,
      }),
      { net: 0, tax: 0, rewards: 0 },
    );
    if (totals.net + totals.tax !== request.amountCents || request.lines.length === 0)
      throw new AccountError("Refund allocation requires review.", 409);
    const original = refundRequestInput.parse({
      requestKey: request.requestKey,
      orderId: request.orderId,
      paymentId: request.paymentId,
      reason: request.reason,
      lines: request.lines
        .map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity }))
        .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
    });
    if (fingerprint(original) !== request.requestHash)
      throw new AccountError("Saved refund request changed.", 409);
    const rewardAmounts = await refundRewardAmounts(tx, request.orderId);
    for (const line of request.lines)
      if (line.rewardCents > (rewardAmounts.get(line.orderItemId) ?? 0))
        throw new AccountError("Refund reward allocation requires review.", 409);
    for (const line of request.lines) {
      const item = request.order.items.find((i) => i.id === line.orderItemId);
      const active = request.order.refundRequests
        .filter((r) =>
          reservedRefundStates.includes(
            r.status as (typeof reservedRefundStates)[number],
          ),
        )
        .flatMap((r) => r.lines)
        .filter((l) => l.orderItemId === line.orderItemId);
      if (
        !item ||
        active.reduce((s, l) => s + l.quantity, 0) > item.quantity ||
        active.reduce((s, l) => s + l.netCents, 0) >
          item.lineTotalCents - item.taxCents ||
        active.reduce((s, l) => s + l.taxCents, 0) > item.taxCents ||
        active.reduce((s, l) => s + l.rewardCents, 0) > (rewardAmounts.get(item.id) ?? 0)
      )
        throw new AccountError("Refund allocation exceeds the saved purchase.", 409);
    }
    const settled = request.adjustments.find((a) => a.kind === "SETTLEMENT");
    const compensated = request.adjustments.find((a) => a.kind === "COMPENSATION");
    if (
      (request.status === "SUCCEEDED" && (!settled || compensated)) ||
      (transition.settle && (settled || compensated)) ||
      (transition.compensate && (!settled || compensated))
    )
      throw new AccountError("Refund accounting history requires reconciliation.", 409);
    if (request.status === transition.target && request.providerRefundId === observed.id)
      return publicRefundRequest(request);
    if (transition.settle || transition.compensate) {
      const sign = transition.compensate ? -1 : 1;
      if (
        settled &&
        (settled.cashCents !== request.amountCents ||
          settled.netCents !== totals.net ||
          settled.taxCents !== totals.tax ||
          settled.rewardCents !== totals.rewards ||
          settled.currency !== request.currency)
      )
        throw new AccountError("Refund accounting amounts require reconciliation.", 409);
      await tx.refundAdjustment.create({
        data: {
          requestId: request.id,
          kind: transition.compensate ? "COMPENSATION" : "SETTLEMENT",
          cashCents: sign * request.amountCents,
          netCents: sign * totals.net,
          taxCents: sign * totals.tax,
          rewardCents: sign * totals.rewards,
          currency: request.currency,
          providerRefundId: observed.id,
          balanceTransactionId: observed.balanceTransactionId,
          failureBalanceTransactionId: observed.failureBalanceTransactionId,
          // An allocated tax credit is not proof Stripe has posted its tax reversal.
          taxEvidenceStatus: "UNVERIFIED",
        },
      });
      if (transition.settle)
        await tx.refund.create({
          data: {
            requestId: request.id,
            orderId: request.orderId,
            paymentId: request.paymentId,
            amountCents: request.amountCents,
            currency: request.currency,
            reason: request.reason,
            externalId: observed.id,
          },
        });
      if (totals.rewards)
        await tx.rewardEntry.create({
          data: {
            customerId: request.order.customerId,
            orderId: request.orderId,
            sourceId: request.id,
            kind: transition.compensate ? "REVERSAL" : "RESTORE",
            amountCents: sign * totals.rewards,
            entryKey: `refund:${request.id}:${transition.compensate ? "compensate" : "restore"}`,
            description: transition.compensate
              ? "Refund failed; restored reward credit reversed"
              : "Reward credit restored for refunded merchandise",
          },
        });
    }
    const saved = await tx.refundRequest.update({
      where: { id: request.id },
      data: {
        status: transition.target,
        providerRefundId: observed.id,
        reconciledAt: new Date(),
        lastError: null,
      },
    });
    await tx.refundRequestEvent.create({
      data: {
        refundRequestId: request.id,
        providerEventId: `dd:refund:settlement:${request.id}:${fingerprint({ version: request.updatedAt, observed })}`,
        type: "refund.reconciled",
        status: transition.target,
        verifiedAt: new Date(),
        evidenceJson: {
          providerStatus: observed.status,
          providerRefundId: observed.id,
          amountCents: request.amountCents,
          balanceTransactionId: observed.balanceTransactionId,
          failureBalanceTransactionId: observed.failureBalanceTransactionId,
          taxEvidenceStatus: "UNVERIFIED",
        },
      },
    });
    const refunds = await tx.refund.findMany({
      where: { paymentId: request.paymentId },
      include: { request: { include: { adjustments: true } } },
    });
    const net = refunds.reduce((s, r) => s + effectiveRefundCents(r), 0);
    if (net < 0 || net > request.payment.amountCents)
      throw new AccountError("Refunds exceed the captured payment.", 409);
    await tx.payment.update({
      where: { id: request.paymentId },
      data: {
        status:
          net === 0
            ? "CAPTURED"
            : net === request.payment.amountCents
              ? "REFUNDED"
              : "PARTIALLY_REFUNDED",
      },
    });
    if (referral) await reviewReferralInTransaction(tx, userId, referral.id);
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "refund.settlement.reconciled",
        entityType: "RefundRequest",
        entityId: request.id,
        beforeJson: { status: request.status },
        afterJson: {
          status: saved.status,
          cashCents: net,
          rewardDeltaCents: transition.settle
            ? totals.rewards
            : transition.compensate
              ? -totals.rewards
              : 0,
          taxEvidenceStatus: "UNVERIFIED",
        },
      },
    });
    return publicRefundRequest(saved);
  });
}

/** Local credit restoration only. Never creates a zero-value provider refund. */
export async function settleRewardOnlyRefund(userId: string, raw: unknown) {
  const input = submissionInput.parse(raw);
  await refundAccess(prisma, userId);
  if (!["development", "staging", "production"].includes(process.env.APP_ENV ?? ""))
    throw new AccountError("Application environment needs review.", 503);
  return prisma.$transaction(async (tx) => {
    await refundAccess(tx, userId);
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { qualifyingReferral: true },
    });
    if (!order) throw new AccountError("Order not found.", 404);
    const referral = order.qualifyingReferral;
    for (const id of [
      ...new Set([
        order.customerId,
        ...(referral ? [referral.referrerId, referral.refereeId] : []),
      ]),
    ].sort())
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${id} FOR UPDATE`;
    if (referral)
      await tx.$queryRaw`SELECT id FROM "Referral" WHERE id = ${referral.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const current = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { qualifyingReferral: true },
    });
    if (
      current.customerId !== order.customerId ||
      current.qualifyingReferral?.id !== referral?.id
    )
      throw new AccountError("Order changed. Refresh before restoring credit.", 409);
    const previous = await tx.refundRequest.findUnique({
      where: { id: input.requestId },
      include: { adjustments: true },
    });
    if (
      previous?.orderId === input.orderId &&
      previous.status === "SUCCEEDED" &&
      previous.amountCents === 0 &&
      !previous.providerRefundId &&
      !previous.submittedAt &&
      previous.adjustments.some((a) => a.kind === "REWARD_ONLY")
    )
      return publicRefundRequest(previous);
    const { request } = await validatedPreparedRefund(
      tx,
      input,
      {
        accountId: previous?.providerAccountId ?? "",
        live: process.env.APP_ENV === "production",
      },
      true,
    );
    const rewards = request.lines.reduce((n, l) => n + l.rewardCents, 0);
    await tx.refundAdjustment.create({
      data: {
        requestId: request.id,
        kind: "REWARD_ONLY",
        cashCents: 0,
        netCents: 0,
        taxCents: 0,
        rewardCents: rewards,
        currency: request.currency,
        taxEvidenceStatus: "NOT_APPLICABLE",
      },
    });
    await tx.rewardEntry.create({
      data: {
        customerId: order.customerId,
        orderId: order.id,
        sourceId: request.id,
        kind: "RESTORE",
        amountCents: rewards,
        entryKey: `refund:${request.id}:restore`,
        description: "Original reward credit restored; no cash refund",
      },
    });
    const saved = await tx.refundRequest.update({
      where: { id: request.id },
      data: { status: "SUCCEEDED", reconciledAt: new Date() },
    });
    await tx.refundRequestEvent.create({
      data: {
        refundRequestId: request.id,
        providerEventId: `dd:reward-refund:${request.id}`,
        type: "refund.reward-only.settled",
        status: "SUCCEEDED",
        evidenceJson: {
          rewardCents: rewards,
          cashCents: 0,
          source: "original-redemption",
        },
      },
    });
    if (referral) await reviewReferralInTransaction(tx, userId, referral.id);
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "refund.reward-only.settled",
        entityType: "RefundRequest",
        entityId: request.id,
        beforeJson: { status: "PREPARED" },
        afterJson: { status: "SUCCEEDED", rewardCents: rewards, cashCents: 0 },
      },
    });
    return publicRefundRequest(saved);
  });
}

function publicRefundRequest(request: {
  id: string;
  orderId: string;
  paymentId: string;
  amountCents: number;
  currency: string;
  reason: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: request.id,
    orderId: request.orderId,
    paymentId: request.paymentId,
    amountCents: request.amountCents,
    currency: request.currency,
    reason: request.reason,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
  };
}

/**
 * Persist and reserve an exact refund request before any provider call. This boundary
 * intentionally performs no network request while locks are held.
 */
export async function prepareRefund(userId: string, raw: unknown) {
  return prepareRefundInternal(userId, raw, false);
}
export async function prepareRewardOnlyRefund(userId: string, raw: unknown) {
  return prepareRefundInternal(userId, raw, true);
}
async function prepareRefundInternal(userId: string, raw: unknown, rewardOnly: boolean) {
  const input = refundRequestInput.parse(raw);
  input.lines.sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  const requestHash = fingerprint(input);
  await refundAccess(prisma, userId);
  if (
    rewardOnly &&
    !["development", "staging", "production"].includes(process.env.APP_ENV ?? "")
  )
    throw new AccountError("Application environment needs review.", 503);
  const commerce = rewardOnly ? null : await readCommerce(true);
  return prisma.$transaction(
    async (tx) => {
      await refundAccess(tx, userId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"refund:" + input.requestKey}, 0))`;
      const prior = await tx.refundRequest.findUnique({
        where: { requestKey: input.requestKey },
      });
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new AccountError(
            "This request key was already used for another refund.",
            409,
          );
        if (rewardOnly && prior.amountCents !== 0)
          throw new AccountError("This draft includes a cash refund.", 409);
        return publicRefundRequest(prior);
      }
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: {
          items: true,
          payments: {
            include: {
              events: true,
              refunds: { include: { request: { include: { adjustments: true } } } },
            },
          },
          rewardReservation: true,
          checkoutAttempt: {
            select: { id: true, state: true, stripeAccountId: true, livemode: true },
          },
          refundRequests: { include: { lines: true } },
          refunds: true,
        },
      });
      if (!order) throw new AccountError("Order not found.", 404);
      if (
        !["PAID", "FULFILLING", "OUT_FOR_DELIVERY", "DELIVERED", "REFUNDED"].includes(
          order.status,
        )
      )
        throw new AccountError("Only a verified paid order can be refunded.", 409);
      const binding = commerce ?? {
        accountId: order.checkoutAttempt?.stripeAccountId ?? "",
        live: process.env.APP_ENV === "production",
      };
      if (
        !order.checkoutAttempt ||
        !/^acct_[A-Za-z0-9]+$/.test(binding.accountId) ||
        (rewardOnly && order.currency !== "USD") ||
        order.checkoutAttempt.state !== "PAID" ||
        order.checkoutAttempt.stripeAccountId !== binding.accountId ||
        order.checkoutAttempt.livemode !== binding.live
      )
        throw new AccountError("The payment environment does not match this order.", 409);
      if (order.refunds.some((refund) => !refund.requestId))
        throw new AccountError(
          "This order has a legacy refund that requires reconciliation.",
          409,
        );
      const payment = order.payments.find(
        (candidate) => candidate.id === input.paymentId,
      );
      if (
        !payment ||
        payment.provider !== "STRIPE" ||
        !["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status) ||
        payment.amountCents !== order.totalCents ||
        payment.currency !== order.currency ||
        !payment.externalId?.startsWith("pi_") ||
        !payment.events.some(
          (event) =>
            event.verifiedAt &&
            ["checkout.session.completed", "checkout.session.reconciled"].includes(
              event.type,
            ) &&
            event.externalId === `checkout:${order.checkoutAttempt!.id}:paid`,
        )
      )
        throw new AccountError("Verified Stripe payment evidence is required.", 409);

      const requestedIds = new Set(input.lines.map((line) => line.orderItemId));
      if (
        requestedIds.size !== input.lines.length ||
        input.lines.some(
          (line) => !order.items.some((item) => item.id === line.orderItemId),
        )
      )
        throw new AccountError("A refund item does not belong to this order.", 409);
      const active = order.refundRequests.filter((request) =>
        reservedRefundStates.includes(
          request.status as (typeof reservedRefundStates)[number],
        ),
      );
      const rewardAmounts = await refundRewardAmounts(tx, order.id);
      let amountCents = 0;
      const lines = input.lines.map((line) => {
        const itemIndex = order.items.findIndex((item) => item.id === line.orderItemId);
        const item = order.items[itemIndex];
        const reservedLines = active
          .flatMap((request) => request.lines)
          .filter((saved) => saved.orderItemId === item.id);
        const alreadyRefunded = reservedLines.reduce(
          (sum, saved) => sum + saved.quantity,
          0,
        );
        if (alreadyRefunded + line.quantity > item.quantity)
          throw new AccountError(
            "Refund quantity exceeds the remaining purchased quantity.",
            409,
          );
        const allocated = allocateRemainingRefundLine({
          quantities: {
            purchased: item.quantity,
            alreadyRefunded,
            requested: line.quantity,
          },
          netCents: item.lineTotalCents - item.taxCents,
          taxCents: item.taxCents,
          rewardCents: rewardAmounts.get(item.id) ?? 0,
          allocated: reservedLines.reduce(
            (sum, saved) => ({
              netCents: sum.netCents + saved.netCents,
              taxCents: sum.taxCents + saved.taxCents,
              rewardCents: sum.rewardCents + saved.rewardCents,
            }),
            { netCents: 0, taxCents: 0, rewardCents: 0 },
          ),
        });
        amountCents += allocated.cashCents;
        return {
          orderItemId: item.id,
          quantity: line.quantity,
          netCents: allocated.netCents,
          taxCents: allocated.taxCents,
          rewardCents: allocated.rewardCents,
        };
      });
      if (rewardOnly && amountCents !== 0)
        throw new AccountError(
          "This selection includes cash. Use the payment refund workflow.",
          409,
        );
      if (!amountCents && !lines.some((l) => l.rewardCents > 0))
        throw new AccountError(
          "This selection has no refundable payment or reward credit.",
          409,
        );
      const settledCents = payment.refunds.reduce(
        (sum, refund) => sum + effectiveRefundCents(refund),
        0,
      );
      const unresolvedCents = active
        .filter(
          (request) => request.paymentId === payment.id && request.status !== "SUCCEEDED",
        )
        .reduce((sum, request) => sum + request.amountCents, 0);
      try {
        if (amountCents)
          assertRefundCapacity({
            capturedCents: payment.amountCents,
            settledCents,
            unresolvedCents,
            requestedCents: amountCents,
          });
      } catch {
        throw new AccountError("Refund exceeds the unreserved captured amount.", 409);
      }
      const request = await tx.refundRequest.create({
        data: {
          orderId: order.id,
          paymentId: payment.id,
          actorUserId: userId,
          requestKey: input.requestKey,
          requestHash,
          amountCents,
          currency: payment.currency,
          reason: input.reason,
          providerAccountId: binding.accountId,
          livemode: binding.live,
          lines: { create: lines },
          events: { create: { type: "refund.prepared", status: "PREPARED" } },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "refund.prepared",
          entityType: "RefundRequest",
          entityId: request.id,
          afterJson: {
            orderId: order.id,
            paymentId: payment.id,
            amountCents,
            currency: payment.currency,
          },
        },
      });
      return publicRefundRequest(request);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

/** Release only a draft that has never reached the provider submission boundary. */
export async function cancelPreparedRefund(userId: string, raw: unknown) {
  const input = cancelRefundInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    await refundAccess(tx, userId);
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const request = await tx.refundRequest.findUnique({ where: { id: input.requestId } });
    if (!request || request.orderId !== input.orderId)
      throw new AccountError("Refund request not found.", 404);
    if (
      request.submittedAt ||
      request.providerRefundId ||
      !["PREPARED", "CANCELED"].includes(request.status)
    )
      throw new AccountError(
        "A submitted refund requires provider reconciliation and cannot be canceled here.",
        409,
      );
    if (request.status === "CANCELED") return publicRefundRequest(request);
    const saved = await tx.refundRequest.update({
      where: { id: request.id },
      data: { status: "CANCELED", lastError: null },
    });
    await tx.refundRequestEvent.create({
      data: {
        refundRequestId: request.id,
        type: "refund.draft.canceled",
        status: "CANCELED",
        evidenceJson: { actorUserId: userId, reason: input.reason },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "refund.draft.canceled",
        entityType: "RefundRequest",
        entityId: request.id,
        beforeJson: { status: "PREPARED" },
        afterJson: { status: "CANCELED", reason: input.reason },
      },
    });
    return publicRefundRequest(saved);
  });
}

/** Record goods physically received. This never initiates or implies a payment refund. */
export async function recordStockReturn(userId: string, raw: unknown) {
  const input = stockReturnInput.parse(raw);
  input.lines.sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  const requestHash = fingerprint(input);
  return prisma.$transaction(async (tx) => {
    await refundAccess(tx, userId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"stock-return:" + input.requestKey}, 0))`;
    const prior = await tx.stockReturn.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new AccountError(
          "This request key was already used for another return.",
          409,
        );
      return {
        id: prior.id,
        orderId: prior.orderId,
        receivedAt: prior.receivedAt.toISOString(),
      };
    }
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: true,
        stockReturns: { include: { lines: true } },
        checkoutAttempt: {
          include: {
            costs: { where: { state: "CONSUMED" }, include: { costLayer: true } },
          },
        },
      },
    });
    if (!order) throw new AccountError("Order not found.", 404);
    if (
      order.checkoutAttempt?.state !== "PAID" ||
      new Set(order.items.map((item) => item.productVariantId)).size !==
        order.items.length
    )
      throw new AccountError("Original completed checkout evidence is required.", 409);
    if (
      !["PAID", "FULFILLING", "OUT_FOR_DELIVERY", "DELIVERED", "REFUNDED"].includes(
        order.status,
      )
    )
      throw new AccountError("This order has no completed sale to return.", 409);
    const lines = input.lines.map((line) => {
      const item = order.items.find((candidate) => candidate.id === line.orderItemId);
      if (!item)
        throw new AccountError("A returned item does not belong to this order.", 409);
      const returned = order.stockReturns
        .flatMap((saved) => saved.lines)
        .filter((saved) => saved.orderItemId === item.id)
        .reduce((sum, saved) => sum + saved.quantity, 0);
      if (returned + line.quantity > item.quantity)
        throw new AccountError("Return quantity exceeds the purchased quantity.", 409);
      const costs = order
        .checkoutAttempt!.costs.filter(
          (cost) => cost.costLayer.productVariantId === item.productVariantId,
        )
        .sort(
          (a, b) =>
            a.costLayer.receivedAt.getTime() - b.costLayer.receivedAt.getTime() ||
            a.costLayerId.localeCompare(b.costLayerId),
        );
      if (costs.reduce((sum, cost) => sum + cost.quantity, 0) !== item.quantity)
        throw new AccountError("Original FIFO cost evidence is incomplete.", 409);
      let skip = returned;
      let remaining = line.quantity;
      const costEvidence = costs.flatMap((cost) => {
        const available = Math.max(0, cost.quantity - skip);
        skip = Math.max(0, skip - cost.quantity);
        const quantity = Math.min(remaining, available);
        remaining -= quantity;
        return quantity
          ? [
              {
                allocationId: cost.id,
                costLayerId: cost.costLayerId,
                quantity,
                unitCostCents: cost.unitCostCents,
              },
            ]
          : [];
      });
      return { ...line, item, costEvidence };
    });
    const saved = await tx.stockReturn.create({
      data: {
        orderId: order.id,
        actorUserId: userId,
        requestKey: input.requestKey,
        requestHash,
        reason: input.reason,
        receivedAt: new Date(),
        lines: {
          create: lines.map((line) => ({
            orderItemId: line.orderItemId,
            quantity: line.quantity,
            condition: line.condition,
            costEvidence: line.costEvidence,
          })),
        },
      },
    });
    for (const line of [...lines].sort((a, b) =>
      a.item.productVariantId.localeCompare(b.item.productVariantId),
    )) {
      await persistInventoryTransaction(tx, {
        productVariantId: line.item.productVariantId,
        type: line.condition === "SELLABLE" ? "RETURN" : "DAMAGE",
        quantity: line.quantity,
        inboundDamage: line.condition === "DAMAGED",
        referenceType: "StockReturn",
        referenceId: saved.id,
        reason: input.reason,
        createdByUserId: userId,
      });
      if (line.condition === "SELLABLE") {
        for (const cost of line.costEvidence) {
          await tx.inventoryCostLayer.update({
            where: { id: cost.costLayerId },
            data: { quantityRemaining: { increment: cost.quantity } },
          });
        }
      }
    }
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "stock.return.received",
        entityType: "StockReturn",
        entityId: saved.id,
        afterJson: {
          orderId: order.id,
          lines: lines.map((line) => ({
            orderItemId: line.orderItemId,
            quantity: line.quantity,
            condition: line.condition,
          })),
        },
      },
    });
    return {
      id: saved.id,
      orderId: saved.orderId,
      receivedAt: saved.receivedAt.toISOString(),
    };
  });
}

/** Staff entry point. Activation never follows merely from adding Stripe credentials. */
export async function cashRefundReadiness(userId: string) {
  await refundAccess(prisma, userId);
  try {
    const c = await readCommerce(true);
    const expected = `${c.live ? "live" : "sandbox"}:${c.accountId}`;
    return {
      enabled:
        process.env.DD_CASH_REFUNDS_ENABLED === "true" &&
        process.env.DD_CASH_REFUNDS_ACCEPTED_ACCOUNT === expected,
    };
  } catch {
    return { enabled: false };
  }
}
export async function submitCashRefundOperation(userId: string, raw: unknown) {
  const input = submissionInput.parse(raw);
  if (!(await cashRefundReadiness(userId)).enabled)
    throw new AccountError(
      "Cash refund submission is not activated. The draft is preserved.",
      503,
    );
  // Durable submission claims and provider idempotency remain in the existing service.
  return submitPreparedRefund(userId, input);
}
export async function reconcileCashRefundOperation(userId: string, raw: unknown) {
  const input = submissionInput.parse(raw);
  await refundAccess(prisma, userId);
  const current = await prisma.refundRequest.findFirst({
    where: {
      id: input.requestId,
      orderId: input.orderId,
      amountCents: { gt: 0 },
      submittedAt: { not: null },
    },
    select: { status: true },
  });
  if (!current) throw new AccountError("A submitted cash refund was not found.", 404);
  if (["SUBMITTING", "UNKNOWN"].includes(current.status))
    await recoverRefundSubmission(userId, input);
  // Recovery stays available with checkout/submission disabled. It never creates money movement.
  return reconcileRefundSettlement(userId, input);
}
