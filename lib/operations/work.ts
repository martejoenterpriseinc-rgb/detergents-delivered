import { runDeliveryTexts } from "@/lib/services/sms-delivery";
import { smsConfig } from "@/lib/integrations/twilio-client";
import { reconcileScheduledQuickbooksCostJournals } from "@/lib/services/quickbooks-cost-journals";
import { reconcileScheduledQuickbooksReceipts } from "@/lib/services/quickbooks-receipt-posting";
import { reconcileScheduledQuickbooksExpenses } from "@/lib/services/quickbooks-expenses";
import {
  authorizedQuickbooks,
  refreshQuickbooksWorker,
} from "@/lib/services/quickbooks-connection";
import { quickbooksWorkerAuthority } from "@/lib/services/quickbooks-worker-authority";
import { reconcileScheduledRefunds } from "@/lib/services/refunds";
import { prisma } from "@/lib/prisma";
import { readCommerce } from "@/lib/commerce/runtime";
import { reconcileCheckout } from "@/lib/commerce/checkout";
import {
  deliverRecoveryEmails,
  runtimeRecoveryEmailConfiguration,
} from "@/lib/services/password-recovery";
import { type JobResult, type JobName, runJob } from "./jobs";

import { generateDueSubscriptionCycles } from "@/lib/services/subscription-cycles";
const blocked = (reason: JobResult["reason"] = "PROVIDER_SETUP_REQUIRED"): JobResult => ({
  state: "BLOCKED",
  checked: 0,
  completed: 0,
  attention: 0,
  reason,
});
export async function paymentRecoveryWork(
  ownsLease: () => Promise<boolean>,
): Promise<JobResult> {
  try {
    await readCommerce(true);
  } catch {
    return blocked();
  }
  const attempts = await prisma.checkoutAttempt.findMany({
    where: { state: { in: ["PREPARING", "OPEN", "PROCESSING", "REVIEW"] } },
    orderBy: [
      { recoveryCheckedAt: { sort: "asc", nulls: "first" } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    take: 10,
    select: { id: true, stripeSessionId: true },
  });
  let checked = 0,
    completed = 0,
    attention = 0;
  for (const attempt of attempts) {
    if (!(await ownsLease())) throw new Error("Worker lease expired.");
    await prisma.checkoutAttempt.updateMany({
      where: {
        id: attempt.id,
        state: { in: ["PREPARING", "OPEN", "PROCESSING", "REVIEW"] },
      },
      data: { recoveryCheckedAt: new Date() },
    });
    checked++;
    if (!attempt.stripeSessionId) {
      // Provider creation uncertainty never releases reservations or retries a new charge.
      await prisma.checkoutAttempt.updateMany({
        where: { id: attempt.id, stripeSessionId: null, state: "PREPARING" },
        data: { lastError: "PAYMENT_SETUP_UNCONFIRMED" },
      });
      attention++;
      continue;
    }
    try {
      await reconcileCheckout(attempt.id);
      const latest = await prisma.checkoutAttempt.findUnique({
        where: { id: attempt.id },
        select: { state: true },
      });
      if (latest?.state === "REVIEW") attention++;
      else completed++;
    } catch {
      attention++;
    }
  }
  return {
    state: attention ? "ATTENTION" : "HEALTHY",
    checked,
    completed,
    attention,
    ...(attention ? { reason: "PAYMENT_REVIEW_REQUIRED" as const } : {}),
  };
}
export async function emailRecoveryWork(
  ownsLease: () => Promise<boolean>,
): Promise<JobResult> {
  if (process.env.DD_RECOVERY_DELIVERY_ENABLED !== "true")
    return blocked("DELIVERY_DISABLED");
  try {
    await runtimeRecoveryEmailConfiguration();
  } catch {
    return blocked();
  }
  if (!(await ownsLease())) throw new Error("Worker lease expired.");
  const result = await deliverRecoveryEmails(5);
  const exhausted = await prisma.passwordRecovery.count({
    where: {
      deliveredAt: null,
      consumedAt: null,
      attempts: { gte: 5 },
      expiresAt: { gt: new Date() },
    },
  });
  const attention = result.failed + exhausted;
  return {
    state: attention ? "ATTENTION" : "HEALTHY",
    checked: result.accepted + result.failed,
    completed: result.accepted,
    attention,
    ...(attention ? { reason: "EMAIL_RETRY_REQUIRED" as const } : {}),
  };
}
export async function runOperationalCycle() {
  const [payments, email, subscriptions, refunds, quickbooks, texts] = await Promise.all([
    runOperationalTask("payment-reconciliation"),
    runOperationalTask("recovery-email"),
    runOperationalTask("subscription-cycles"),
    runOperationalTask("refund-reconciliation"),
    runOperationalTask("quickbooks-reconciliation"),
    runOperationalTask("delivery-sms"),
  ]);
  return {
    payments,
    email,
    subscriptions,
    refunds,
    quickbooks,
    texts,
  };
}
export function runOperationalTask(name: JobName) {
  return runJob(
    name,
    name === "payment-reconciliation"
      ? paymentRecoveryWork
      : name === "recovery-email"
        ? emailRecoveryWork
        : name === "refund-reconciliation"
          ? refundRecoveryWork
          : name === "quickbooks-reconciliation"
            ? quickbooksRecoveryWork
            : name === "delivery-sms"
              ? deliveryTextWork
              : subscriptionCycleWork,
  );
}

export async function subscriptionCycleWork(
  ownsLease: () => Promise<boolean>,
): Promise<JobResult> {
  const result = await generateDueSubscriptionCycles(ownsLease);
  return {
    ...result,
    state: result.attention ? "ATTENTION" : "HEALTHY",
    ...(result.attention ? { reason: "SUBSCRIPTION_REVIEW_REQUIRED" as const } : {}),
  };
}

export async function refundRecoveryWork(
  ownsLease: () => Promise<boolean>,
): Promise<JobResult> {
  try {
    await readCommerce(true);
  } catch {
    return blocked();
  }
  const result = await reconcileScheduledRefunds(ownsLease);
  return {
    ...result,
    state: result.attention ? "ATTENTION" : "HEALTHY",
    ...(result.attention ? { reason: "REFUND_REVIEW_REQUIRED" as const } : {}),
  };
}

export async function quickbooksRecoveryWork(
  ownsLease: () => Promise<boolean>,
): Promise<JobResult> {
  if (!(await ownsLease())) throw new Error("Worker lease expired.");
  try {
    await refreshQuickbooksWorker();
    await authorizedQuickbooks(quickbooksWorkerAuthority);
  } catch {
    return blocked();
  }
  const expenses = await reconcileScheduledQuickbooksExpenses(ownsLease);
  const journals = await reconcileScheduledQuickbooksCostJournals(ownsLease);
  const receipts = await reconcileScheduledQuickbooksReceipts(ownsLease);
  const result = {
    checked: expenses.checked + journals.checked + receipts.checked,
    completed: expenses.completed + journals.completed + receipts.completed,
    attention: expenses.attention + journals.attention + receipts.attention,
  };
  return {
    ...result,
    state: result.attention ? "ATTENTION" : "HEALTHY",
    ...(result.attention ? { reason: "ACCOUNTING_REVIEW_REQUIRED" as const } : {}),
  };
}

export async function deliveryTextWork(
  ownsLease: () => Promise<boolean>,
): Promise<JobResult> {
  try {
    await smsConfig();
  } catch {
    return blocked();
  }
  const result = await runDeliveryTexts(ownsLease);
  return {
    checked: result.checked,
    completed: result.completed,
    attention: result.attention,
    state: result.attention ? "ATTENTION" : result.enabled ? "HEALTHY" : "BLOCKED",
    ...(result.attention
      ? { reason: "SMS_REVIEW_REQUIRED" as const }
      : !result.enabled
        ? { reason: "DELIVERY_DISABLED" as const }
        : {}),
  };
}
