import "@/tests/integration-guard";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  claimJob,
  finishJob,
  heartbeatJob,
  jobStatus,
  leaseDuration,
  runJob,
} from "./jobs";
import { runOperationalCycle } from "./work";
const ids = [
  "sandbox:payment-reconciliation",
  "sandbox:recovery-email",
  "live:recovery-email",
  "sandbox:subscription-cycles",
  "live:subscription-cycles",
];
beforeEach(async () => {
  expect(await prisma.operationalJob.count({ where: { id: { in: ids } } })).toBe(0);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await prisma.operationalJob.deleteMany({ where: { id: { in: ids } } });
});
it("allows one scheduler claimant and rejects an expired owner after replacement", async () => {
  const now = new Date(Date.now() + 1000);
  const claims = await Promise.all([
    claimJob("recovery-email", now),
    claimJob("recovery-email", now),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const first = claims.find(Boolean)!;
  const later = new Date(now.getTime() + leaseDuration + 1);
  const replacement = await claimJob("recovery-email", later);
  expect(replacement?.leaseId).not.toBe(first.leaseId);
  expect(await heartbeatJob(first.id, first.leaseId!, later)).toBe(false);
  const result = { state: "HEALTHY" as const, checked: 2, completed: 2, attention: 0 };
  expect(await finishJob(first.id, first.leaseId!, result, later)).toBe(false);
  expect(await finishJob(replacement!.id, replacement!.leaseId!, result, later)).toBe(
    true,
  );
  expect((await jobStatus(later)).find((j) => j.name === "recovery-email")).toMatchObject(
    { state: "HEALTHY", completed: 2 },
  );
});
it("records redacted failures, backs off and keeps an idle worker heartbeat current", async () => {
  const result = await runJob("recovery-email", async () => {
    throw new Error("secret-token private@example.test");
  });
  expect(result.state).toBe("FAILED");
  const row = await prisma.operationalJob.findUniqueOrThrow({ where: { id: ids[1] } });
  expect(row.consecutiveFailures).toBe(1);
  expect(row.nextRunAt.getTime()).toBeGreaterThan(row.finishedAt!.getTime());
  const waiting = new Date(row.finishedAt!.getTime() + 30_000);
  expect(await claimJob("recovery-email", waiting)).toBeNull();
  const status = await jobStatus(waiting);
  expect(status.find((j) => j.name === "recovery-email")).toMatchObject({
    state: "FAILED",
    heartbeatAt: waiting.toISOString(),
  });
  expect(JSON.stringify({ row, status })).not.toMatch(/secret-token|private@example/);
  expect(
    (await jobStatus(new Date(waiting.getTime() + 181_000))).find(
      (j) => j.name === "recovery-email",
    )?.state,
  ).toBe("OFFLINE");
});
it("keeps environment leases and status separate and reports absent providers honestly", async () => {
  vi.stubEnv("DD_CHECKOUT_ENABLED", "false");
  vi.stubEnv("DD_RECOVERY_DELIVERY_ENABLED", "false");
  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_RESTRICTED_KEY",
    "DD_SANDBOX_STRIPE_SECRET_KEY",
    "DD_SANDBOX_STRIPE_RESTRICTED_KEY",
  ])
    vi.stubEnv(key, "");
  const cycle = await runOperationalCycle();
  expect(cycle.payments.state).toBe("BLOCKED");
  expect(cycle.email.state).toBe("BLOCKED");
  expect(
    (await jobStatus())
      .filter((j) => j.name !== "subscription-cycles")
      .every((j) => j.state === "BLOCKED" && j.lastSuccessAt === null),
  ).toBe(true);
  expect(cycle.subscriptions.state).toBe("HEALTHY");
  expect((await jobStatus()).find((j) => j.name === "subscription-cycles")).toMatchObject(
    { state: "HEALTHY" },
  );
  vi.stubEnv("APP_ENV", "production");
  expect((await jobStatus()).every((j) => j.state === "NOT_STARTED")).toBe(true);
  const live = await claimJob("recovery-email", new Date(Date.now() + 1000));
  expect(live?.environment).toBe("live");
  expect(live?.id).toBe("live:recovery-email");
});
