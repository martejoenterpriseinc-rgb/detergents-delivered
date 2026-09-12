import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({
  commerce: vi.fn(),
  reconcile: vi.fn(),
  emailConfig: vi.fn(),
  deliver: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  count: vi.fn(),
  tips: vi.fn(),
}));
vi.mock("@/lib/services/delivery-tips", () => ({ recoverDeliveryTips: mocked.tips }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    checkoutAttempt: {
      findMany: mocked.findMany,
      findUnique: mocked.findUnique,
      updateMany: mocked.updateMany,
    },
    passwordRecovery: { count: mocked.count },
  },
}));
vi.mock("@/lib/commerce/runtime", () => ({ readCommerce: mocked.commerce }));
vi.mock("@/lib/commerce/checkout", () => ({ reconcileCheckout: mocked.reconcile }));
vi.mock("@/lib/services/password-recovery", () => ({
  runtimeRecoveryEmailConfiguration: mocked.emailConfig,
  deliverRecoveryEmails: mocked.deliver,
}));
import { paymentRecoveryWork, emailRecoveryWork } from "./work";
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  mocked.updateMany.mockResolvedValue({ count: 1 });
  mocked.tips.mockResolvedValue({ checked: 0, completed: 0, attention: 0 });
});
it("keeps uncertain payments protected and does not count review states as successful processing", async () => {
  mocked.commerce.mockResolvedValue({});
  mocked.findMany.mockResolvedValue([
    { id: "uncertain", stripeSessionId: null },
    { id: "review", stripeSessionId: "cs_review" },
    { id: "paid", stripeSessionId: "cs_paid" },
  ]);
  mocked.findUnique
    .mockResolvedValueOnce({ state: "REVIEW" })
    .mockResolvedValueOnce({ state: "PAID" });
  const result = await paymentRecoveryWork(async () => true);
  expect(result).toEqual({
    state: "ATTENTION",
    checked: 3,
    completed: 1,
    attention: 2,
    reason: "PAYMENT_REVIEW_REQUIRED",
  });
  expect(mocked.reconcile.mock.calls.map((call) => call[0])).toEqual(["review", "paid"]);
});
it("does no provider work after losing the scheduler lease or with missing credentials", async () => {
  mocked.commerce.mockRejectedValueOnce(new Error("private-provider-key"));
  expect(await paymentRecoveryWork(async () => true)).toMatchObject({
    state: "BLOCKED",
    checked: 0,
  });
  expect(mocked.findMany).not.toHaveBeenCalled();
  mocked.commerce.mockResolvedValue({});
  mocked.findMany.mockResolvedValue([{ id: "one", stripeSessionId: "cs_one" }]);
  await expect(paymentRecoveryWork(async () => false)).rejects.toThrow(/lease/);
  expect(mocked.reconcile).not.toHaveBeenCalled();
  expect(mocked.updateMany).not.toHaveBeenCalled();
});
it("does not consume email retries before activation and exposes exhausted delivery as attention", async () => {
  vi.stubEnv("DD_RECOVERY_DELIVERY_ENABLED", "false");
  expect(await emailRecoveryWork(async () => true)).toMatchObject({
    state: "BLOCKED",
    reason: "DELIVERY_DISABLED",
  });
  expect(mocked.deliver).not.toHaveBeenCalled();
  vi.stubEnv("DD_RECOVERY_DELIVERY_ENABLED", "true");
  mocked.emailConfig.mockResolvedValue({});
  mocked.deliver.mockResolvedValue({ accepted: 2, failed: 1 });
  mocked.count.mockResolvedValue(1);
  expect(await emailRecoveryWork(async () => true)).toEqual({
    state: "ATTENTION",
    checked: 3,
    completed: 2,
    attention: 2,
    reason: "EMAIL_RETRY_REQUIRED",
  });
});
