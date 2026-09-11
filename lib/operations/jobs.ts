import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { integrationEnvironment } from "@/lib/integration-environment";

export const jobNames = [
  "payment-reconciliation",
  "refund-reconciliation",
  "quickbooks-reconciliation",
  "recovery-email",
  "delivery-sms",
  "subscription-cycles",
] as const;
export type JobName = (typeof jobNames)[number];
export type JobResult = {
  state: "HEALTHY" | "BLOCKED" | "ATTENTION";
  checked: number;
  completed: number;
  attention: number;
  reason?:
    | "PROVIDER_SETUP_REQUIRED"
    | "PAYMENT_REVIEW_REQUIRED"
    | "REFUND_REVIEW_REQUIRED"
    | "ACCOUNTING_REVIEW_REQUIRED"
    | "EMAIL_RETRY_REQUIRED"
    | "SMS_REVIEW_REQUIRED"
    | "DELIVERY_DISABLED"
    | "SUBSCRIPTION_REVIEW_REQUIRED";
};
export const leaseDuration = 300_000;
export async function claimJob(name: JobName, now = new Date()) {
  const environment = integrationEnvironment();
  if (!environment) throw new Error("Worker environment is not configured.");
  const id = `${environment}:${name}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
    const job = await tx.operationalJob.upsert({
      where: { id },
      update: {},
      create: { id, environment, nextRunAt: now },
    });
    if (job.environment !== environment) throw new Error("Worker environment mismatch.");
    if (job.leasedUntil && job.leasedUntil > now) return null;
    if (job.nextRunAt > now) {
      await tx.operationalJob.update({ where: { id }, data: { heartbeatAt: now } });
      return null;
    }
    return tx.operationalJob.update({
      where: { id },
      data: {
        state: "RUNNING",
        leaseId: randomUUID(),
        leasedUntil: new Date(now.getTime() + leaseDuration),
        heartbeatAt: now,
        startedAt: now,
        reason: null,
      },
    });
  });
}
export async function heartbeatJob(id: string, leaseId: string, now = new Date()) {
  const result = await prisma.operationalJob.updateMany({
    where: { id, leaseId, state: "RUNNING", leasedUntil: { gt: now } },
    data: {
      heartbeatAt: now,
      leasedUntil: new Date(now.getTime() + leaseDuration),
    },
  });
  return result.count === 1;
}
export async function finishJob(
  id: string,
  leaseId: string,
  result: JobResult | null,
  now = new Date(),
) {
  const row = await prisma.operationalJob.findUnique({ where: { id } });
  if (!row || row.leaseId !== leaseId) return false;
  const failures = result ? 0 : row.consecutiveFailures + 1;
  const delay =
    result?.state === "BLOCKED"
      ? 60_000
      : result
        ? 60_000
        : Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures, 5));
  const saved = await prisma.operationalJob.updateMany({
    where: { id, leaseId, state: "RUNNING", leasedUntil: { gt: now } },
    data: {
      state: result?.state ?? "FAILED",
      reason: result?.reason ?? (result ? null : "RUN_FAILED"),
      checked: result?.checked ?? 0,
      completed: result?.completed ?? 0,
      attention: result?.attention ?? 0,
      consecutiveFailures: failures,
      nextRunAt: new Date(now.getTime() + delay),
      finishedAt: now,
      heartbeatAt: now,
      ...(result?.state === "HEALTHY" ? { lastSuccessAt: now } : {}),
      leasedUntil: null,
      leaseId: null,
    },
  });
  return saved.count === 1;
}
export async function runJob(
  name: JobName,
  work: (ownsLease: () => Promise<boolean>) => Promise<JobResult>,
) {
  const claim = await claimJob(name);
  if (!claim?.leaseId) return { claimed: false };
  const leaseId = claim.leaseId;
  let owns = true;
  // Renew before each bounded unit of provider work, not with overlapping timers.
  const ownsLease = async () => {
    if (!owns) return false;
    owns = await heartbeatJob(claim.id, leaseId);
    return owns;
  };
  try {
    const result = await work(ownsLease);
    const committed = await finishJob(claim.id, leaseId, result);
    return { claimed: true, committed, state: result.state };
  } catch {
    await finishJob(claim.id, leaseId, null);
    return { claimed: true, committed: false, state: "FAILED" };
  }
}
export async function jobStatus(now = new Date()) {
  const environment = integrationEnvironment();
  const rows = environment
    ? await prisma.operationalJob.findMany({ where: { environment } })
    : [];
  return jobNames.map((name) => {
    const row = rows.find((r) => r.id === `${environment}:${name}`);
    const overdue =
      !row?.heartbeatAt || now.getTime() - row.heartbeatAt.getTime() > 180_000;
    return {
      name,
      state: row ? (overdue ? "OFFLINE" : row.state) : "NOT_STARTED",
      heartbeatAt: row?.heartbeatAt?.toISOString() ?? null,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      nextRunAt: row?.nextRunAt.toISOString() ?? null,
      checked: row?.checked ?? 0,
      completed: row?.completed ?? 0,
      attention: row?.attention ?? 0,
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      reason: row?.reason ?? null,
    };
  });
}
