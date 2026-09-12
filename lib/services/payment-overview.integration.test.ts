import "@/tests/integration-guard";
import { afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { receiptFixture } from "@/tests/customer-receipt-fixture";
const config = vi.hoisted(() => ({ accountId: "", live: false, enabled: false }));
vi.mock("@/lib/commerce/runtime", () => ({
  runtimeCommerceConfiguration: async () => config,
}));
import { readPaymentOverview } from "./payment-overview";
const fixtures: Awaited<ReturnType<typeof receiptFixture>>[] = [];
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: fixtures.map((f) => f.userId) } },
    data: { deletedAt: new Date() },
  });
  await prisma.product.updateMany({
    where: { id: { in: fixtures.map((f) => f.productId) } },
    data: { isActive: false, websiteVisible: false },
  });
  await prisma.$disconnect();
});
it("uses complete aggregates, current account/mode and paginated matching details without writes", async () => {
  config.accountId = "acct_" + randomUUID().replaceAll("-", "");
  const f = await receiptFixture(prisma);
  fixtures.push(f);
  await prisma.checkoutAttempt.update({
    where: { id: f.checkoutId },
    data: { stripeAccountId: config.accountId },
  });
  const before = await prisma.payment.findMany({ where: { orderId: f.orderId } });
  const data = await readPaymentOverview("year", "succeeded");
  expect(data.metrics.succeeded).toEqual({ count: 1, cents: 2268 });
  expect(data.payments.map((p) => p.orderId)).toEqual([f.orderId]);
  expect(data.metrics.net.cents).toBeNull();
  expect(data.metrics.blocked.count).toBeNull();
  expect((await readPaymentOverview("year", "succeeded", 2)).payments).toHaveLength(0);
  config.live = true;
  expect((await readPaymentOverview("year")).metrics.succeeded.count).toBe(0);
  config.live = false;
  expect(await prisma.payment.findMany({ where: { orderId: f.orderId } })).toEqual(
    before,
  );
});
it("retains recoverable checkouts without orders separately from captured payments", async () => {
  config.accountId = "acct_" + randomUUID().replaceAll("-", "");
  const f = await receiptFixture(prisma);
  fixtures.push(f);
  await prisma.checkoutAttempt.update({
    where: { id: f.checkoutId },
    data: { stripeAccountId: config.accountId, orderId: null, state: "PROCESSING" },
  });
  const processing = await readPaymentOverview("year", "processing");
  expect(processing.metrics.processing.count).toBe(1);
  expect(processing.metrics.succeeded.count).toBe(0);
  expect(processing.attempts[0].stripeSessionId).toBeTruthy();
  await prisma.checkoutAttempt.update({
    where: { id: f.checkoutId },
    data: { state: "REVIEW" },
  });
  expect((await readPaymentOverview("year", "review")).attempts[0].id).toBe(f.checkoutId);
});
it("counts signed refund corrections by entry date without altering gross captured volume", async () => {
  config.accountId = "acct_" + randomUUID().replaceAll("-", "");
  const f = await receiptFixture(prisma);
  fixtures.push(f);
  await prisma.checkoutAttempt.update({
    where: { id: f.checkoutId },
    data: { stripeAccountId: config.accountId },
  });
  const payment = await prisma.payment.findFirstOrThrow({
    where: { orderId: f.orderId },
  });
  const request = await prisma.refundRequest.create({
    data: {
      orderId: f.orderId,
      paymentId: payment.id,
      actorUserId: f.userId,
      requestKey: randomUUID(),
      requestHash: "synthetic",
      amountCents: 108,
      currency: "USD",
      reason: "Synthetic dashboard test",
      providerAccountId: config.accountId,
      livemode: false,
    },
  });
  for (const sign of [1, -1])
    await prisma.refundAdjustment.create({
      data: {
        requestId: request.id,
        kind: sign === 1 ? "SETTLEMENT" : "COMPENSATION",
        cashCents: sign * 108,
        netCents: sign * 100,
        taxCents: sign * 8,
        rewardCents: 0,
        currency: "USD",
        providerRefundId: "re_" + request.id,
      },
    });
  const data = await readPaymentOverview("year", "refunded");
  expect(data.metrics.refunded).toEqual({ count: 2, cents: 0 });
  expect(data.adjustments.map((a) => a.cashCents).sort((a, b) => a - b)).toEqual([
    -108, 108,
  ]);
  expect(data.metrics.gross.cents).toBe(2268);
});
