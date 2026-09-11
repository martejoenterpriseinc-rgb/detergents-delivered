import type Stripe from "stripe";
import { z } from "zod";
import { AccountError } from "@/lib/domain/account";
import { readCommerce } from "./runtime";
import { stripeClient } from "./stripe";

const paymentBinding = z
  .object({
    accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
    live: z.boolean(),
    paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/),
    checkoutId: z.string().min(1).max(100),
    amountCents: z.number().int().positive().max(100_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export type RefundPaymentBinding = z.infer<typeof paymentBinding>;
export type ProviderRefundStatus =
  "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
export type RefundObservation = {
  id: string;
  amountCents: number;
  currency: string;
  status: ProviderRefundStatus;
  created: number;
  requestId: string | null;
  requestHash: string | null;
  project: string | null;
  balanceTransactionId: string | null;
  failureBalanceTransactionId: string | null;
};
export type RefundPaymentObservation = {
  paymentIntentId: string;
  chargeId: string;
  accountId: string;
  live: boolean;
  capturedCents: number;
  currency: string;
  disputed: boolean;
  refunds: RefundObservation[];
};
const reference = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);
const fail = () =>
  new AccountError("Payment refund evidence requires reconciliation.", 409);
const requestOptions = { timeout: 8000, maxNetworkRetries: 0 };

function refundObservation(
  refund: Stripe.Refund,
  binding: RefundPaymentBinding,
  chargeId: string,
): RefundObservation {
  const statuses: readonly string[] = [
    "pending",
    "requires_action",
    "succeeded",
    "failed",
    "canceled",
  ];
  if (
    refund.object !== "refund" ||
    !refund.id ||
    reference(refund.payment_intent) !== binding.paymentIntentId ||
    reference(refund.charge) !== chargeId ||
    refund.currency !== binding.currency.toLowerCase() ||
    !Number.isSafeInteger(refund.amount) ||
    refund.amount <= 0 ||
    refund.amount > binding.amountCents ||
    !Number.isSafeInteger(refund.created) ||
    refund.created <= 0 ||
    !refund.status ||
    !statuses.includes(refund.status)
  )
    throw fail();
  // These are internal reconciliation fields, never a customer/staff response DTO.
  // Deliberately exclude bank instructions, customer email and all raw metadata.
  return {
    id: refund.id,
    amountCents: refund.amount,
    currency: binding.currency,
    status: refund.status as ProviderRefundStatus,
    created: refund.created,
    requestId: refund.metadata?.refundRequestId ?? null,
    requestHash: refund.metadata?.requestHash ?? null,
    project: refund.metadata?.project ?? null,
    balanceTransactionId: reference(refund.balance_transaction),
    failureBalanceTransactionId: reference(refund.failure_balance_transaction),
  };
}

/** Read the original account/payment and a complete bounded refund list. No money moves. */
export async function inspectStripeRefunds(
  raw: RefundPaymentBinding,
): Promise<RefundPaymentObservation> {
  const binding = paymentBinding.parse(raw);
  const config = await readCommerce(true);
  if (config.accountId !== binding.accountId || config.live !== binding.live)
    throw fail();
  const stripe = await stripeClient(config);
  const [account, payment] = await Promise.all([
    stripe.accounts.retrieve(null, {}, requestOptions),
    stripe.paymentIntents.retrieve(binding.paymentIntentId, {}, requestOptions),
  ]);
  const chargeId = reference(payment.latest_charge);
  if (
    account.id !== binding.accountId ||
    payment.id !== binding.paymentIntentId ||
    payment.livemode !== binding.live ||
    payment.status !== "succeeded" ||
    payment.amount !== binding.amountCents ||
    payment.amount_received !== binding.amountCents ||
    payment.currency !== binding.currency.toLowerCase() ||
    payment.metadata.project !== "detergents-delivered" ||
    payment.metadata.checkoutId !== binding.checkoutId ||
    !chargeId
  )
    throw fail();
  const charge = await stripe.charges.retrieve(chargeId, {}, requestOptions);
  if (
    charge.id !== chargeId ||
    reference(charge.payment_intent) !== binding.paymentIntentId ||
    charge.livemode !== binding.live ||
    !charge.paid ||
    !charge.captured ||
    charge.amount !== binding.amountCents ||
    charge.amount_captured !== binding.amountCents ||
    charge.currency !== binding.currency.toLowerCase()
  )
    throw fail();

  const refunds: RefundObservation[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  // Never assume the ten embedded Charge refunds are the full history. If an
  // unusually large history exceeds this bound, stop for review without truncation.
  for (let page = 0; page < 5; page++) {
    const result = await stripe.refunds.list(
      {
        payment_intent: binding.paymentIntentId,
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      },
      requestOptions,
    );
    for (const rawRefund of result.data) {
      const refund = refundObservation(rawRefund, binding, chargeId);
      if (seen.has(refund.id)) throw fail();
      seen.add(refund.id);
      refunds.push(refund);
    }
    if (!result.has_more)
      return {
        paymentIntentId: binding.paymentIntentId,
        chargeId,
        accountId: account.id,
        live: binding.live,
        capturedCents: binding.amountCents,
        currency: binding.currency,
        disputed: charge.disputed,
        refunds,
      };
    if (!result.data.length) throw fail();
    cursor = result.data[result.data.length - 1].id;
  }
  throw new AccountError(
    "Refund history exceeds automatic reconciliation capacity. Staff review is required.",
    409,
  );
}

export type ExpectedProviderRefund = {
  id: string;
  requestHash: string;
  providerRefundId: string | null;
  submitted: boolean;
  amountCents: number;
  currency: string;
};

/** Detect external, duplicate or mismatched refunds before trusting local capacity. */
export function matchProviderRefunds(
  observation: RefundPaymentObservation,
  expected: readonly ExpectedProviderRefund[],
) {
  const matched = new Map<string, RefundObservation>();
  for (const refund of observation.refunds) {
    const candidates = expected.filter(
      (request) =>
        request.submitted &&
        (request.providerRefundId === refund.id ||
          (!request.providerRefundId && request.id === refund.requestId)),
    );
    const request = candidates.length === 1 ? candidates[0] : null;
    if (
      !request ||
      matched.has(request.id) ||
      refund.project !== "detergents-delivered" ||
      refund.requestId !== request.id ||
      refund.requestHash !== request.requestHash ||
      refund.amountCents !== request.amountCents ||
      refund.currency !== request.currency
    )
      throw fail();
    matched.set(request.id, refund);
  }
  // A known provider ID disappearing is an unresolved lookup, not proof of failure.
  if (expected.some((request) => request.providerRefundId && !matched.has(request.id)))
    throw fail();
  const reservedCents = observation.refunds
    .filter((refund) => !["failed", "canceled"].includes(refund.status))
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  if (!Number.isSafeInteger(reservedCents) || reservedCents > observation.capturedCents)
    throw fail();
  return { matched, reservedCents };
}

const submission = z
  .object({
    requestId: z.string().min(1).max(100),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    amountCents: z.number().int().positive().max(100_000_000),
    submittedAt: z.string().datetime(),
    binding: paymentBinding,
  })
  .strict();

/** Internal adapter. The caller must first commit claimRefundSubmission exactly once.
 * Not wired to HTTP, workers or startup until settlement/reversal acceptance is complete.
 */
export async function submitClaimedStripeRefund(
  raw: z.infer<typeof submission>,
  otherRequests: readonly ExpectedProviderRefund[],
): Promise<RefundObservation> {
  const input = submission.parse(raw);
  const age = Date.now() - new Date(input.submittedAt).getTime();
  // Do not reuse a create key after a crash/delayed retry: Stripe may prune old keys.
  if (
    age < 0 ||
    age > 10 * 60 * 1000 ||
    otherRequests.some((r) => r.id === input.requestId)
  )
    throw fail();
  const observation = await inspectStripeRefunds(input.binding);
  const current = {
    id: input.requestId,
    requestHash: input.requestHash,
    providerRefundId: null,
    submitted: true,
    amountCents: input.amountCents,
    currency: input.binding.currency,
  };
  const { matched, reservedCents } = matchProviderRefunds(observation, [
    ...otherRequests,
    current,
  ]);
  const existing = matched.get(input.requestId);
  if (existing) return existing;
  if (
    observation.disputed ||
    input.amountCents + reservedCents > observation.capturedCents ||
    otherRequests.some(
      (r) =>
        r.submitted &&
        (!matched.has(r.id) ||
          ["pending", "requires_action"].includes(matched.get(r.id)!.status)),
    )
  )
    throw fail();
  const config = await readCommerce(true);
  if (config.accountId !== input.binding.accountId || config.live !== input.binding.live)
    throw fail();
  const stripe = await stripeClient(config);
  const result = refundObservation(
    await stripe.refunds.create(
      {
        payment_intent: input.binding.paymentIntentId,
        amount: input.amountCents,
        metadata: {
          project: "detergents-delivered",
          refundRequestId: input.requestId,
          requestHash: input.requestHash,
        },
      },
      {
        ...requestOptions,
        idempotencyKey: `dd:refund:${input.requestId}:${input.requestHash}:v1`,
      },
    ),
    input.binding,
    observation.chargeId,
  );
  // A response is evidence, not settlement. Any error leaves the durable claim reserved.
  matchProviderRefunds({ ...observation, refunds: [...observation.refunds, result] }, [
    ...otherRequests,
    current,
  ]);
  return result;
}
