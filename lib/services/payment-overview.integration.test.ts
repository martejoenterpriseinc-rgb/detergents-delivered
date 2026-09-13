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
async function makeFixture() {
  const f = await receiptFixture(prisma);
  const role = await prisma.role.upsert({
    where: { code: "ADMIN" },
    update: {},
    create: { code: "ADMIN", name: "Admin" },
  });
  await prisma.userRole.create({ data: { userId: f.userId, roleId: role.id } });
  return f;
}
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
  const f = await makeFixture();
  fixtures.push(f);
  await prisma.checkoutAttempt.update({
    where: { id: f.checkoutId },
    data: { stripeAccountId: config.accountId },
  });
  const before = await prisma.payment.findMany({ where: { orderId: f.orderId } });
  const data = await readPaymentOverview(f.userId, { period: "year" }, "succeeded");
  expect(data.metrics.succeeded).toEqual({ count: 1, cents: 2268 });
  expect(data.rows.map((p) => p.order_id)).toEqual([f.orderId]);
  expect(data.metrics.net.cents).toBe(2268);
  expect(data.metrics.blocked.count).toBeNull();
  expect(
    (await readPaymentOverview(f.userId, { period: "year", page: 2 }, "succeeded")).rows,
  ).toHaveLength(0);
  config.live = true;
  vi.stubEnv("APP_ENV", "production");
  expect(
    (await readPaymentOverview(f.userId, { period: "year" })).metrics.succeeded.count,
  ).toBe(0);
  config.live = false;
  vi.stubEnv("APP_ENV", "development");
  expect(await prisma.payment.findMany({ where: { orderId: f.orderId } })).toEqual(
    before,
  );
});
it("retains recoverable checkouts without orders separately from captured payments", async () => {
  config.accountId = "acct_" + randomUUID().replaceAll("-", "");
  const f = await makeFixture();
  fixtures.push(f);
  await prisma.checkoutAttempt.update({
    where: { id: f.checkoutId },
    data: { stripeAccountId: config.accountId, orderId: null, state: "PROCESSING" },
  });
  const processing = await readPaymentOverview(
    f.userId,
    { period: "year" },
    "processing",
  );
  expect(processing.metrics.processing.count).toBe(1);
  expect(processing.metrics.succeeded.count).toBe(0);
  expect(processing.rows[0].reference).toBeTruthy();
  await prisma.checkoutAttempt.update({
    where: { id: f.checkoutId },
    data: { state: "REVIEW" },
  });
  expect(
    (await readPaymentOverview(f.userId, { period: "year" }, "review")).rows[0].id,
  ).toBe(f.checkoutId);
});
it("counts signed refund corrections by entry date without altering gross captured volume", async () => {
  config.accountId = "acct_" + randomUUID().replaceAll("-", "");
  const f = await makeFixture();
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
  const data = await readPaymentOverview(f.userId, { period: "year" }, "refunded");
  expect(data.metrics.refunded).toEqual({ count: 2, cents: 0 });
  expect(data.rows.map((a) => a.cents!).sort((a, b) => a - b)).toEqual([-108, 108]);
  expect(data.metrics.gross.cents).toBe(2268);
});
it("aggregates more than 100 records, paginates, searches and exports the same exact set", async () => {
  config.accountId = "acct_" + randomUUID().replaceAll("-", "");
  const f = await makeFixture();
  fixtures.push(f);
  await prisma.checkoutAttempt.update({
    where: { id: f.checkoutId },
    data: { stripeAccountId: config.accountId },
  });
  await prisma.payment.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      orderId: f.orderId,
      provider: "STRIPE" as const,
      status: "FAILED" as const,
      amountCents: 100 + i,
      externalId: "pi_kpi_" + randomUUID(),
    })),
  });
  const filter = { period: "year", q: "RECEIPT-", sort: "amountDesc" };
  const d = await readPaymentOverview(f.userId, filter, "failed");
  expect(d.metrics.failed).toEqual({ count: 125, cents: 20250 });
  expect(d.rows).toHaveLength(50);
  expect(d.rows[0].cents).toBe(224);
  const next = await readPaymentOverview(f.userId, { ...filter, page: 3 }, "failed");
  expect(next.rows).toHaveLength(25);
  const all = await readPaymentOverview(f.userId, filter, "failed", true);
  expect(all.rows).toHaveLength(125);
  expect(
    (await readPaymentOverview(f.userId, { ...filter, q: "no-such-reference" }, "failed"))
      .count,
  ).toBe(0);
  expect(
    (await readPaymentOverview(f.userId, { ...filter, method: "CASH" }, "failed")).count,
  ).toBe(0);
  expect(d.metrics.declined.cents).toBeNull();
  expect(d.metrics.blocked.count).toBeNull();
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  await prisma.userRole.delete({
    where: { userId_roleId: { userId: f.userId, roleId: role.id } },
  });
  await expect(
    readPaymentOverview(f.userId, filter, "failed", true),
  ).rejects.toMatchObject({ status: 403 });
});
it("uses receipt dates for cash and Zelle, and isolates manual records by environment", async () => {
  for (const method of ["CASH", "ZELLE"] as const) {
    const f = await receiptFixture(prisma, { financialEvidence: true, manual: method });
    fixtures.push(f);
    const c = await prisma.checkoutAttempt.findUniqueOrThrow({
      where: { id: f.checkoutId },
    });
    config.accountId = c.stripeAccountId;
    const role = await prisma.role.upsert({
      where: { code: "ADMIN" },
      update: {},
      create: { code: "ADMIN", name: "Admin" },
    });
    await prisma.userRole.create({ data: { userId: f.userId, roleId: role.id } });
    const d = await readPaymentOverview(
      f.userId,
      { period: "year", customer: c.customerId, method },
      method === "CASH" ? "cash" : "zelle",
    );
    expect(d.count).toBe(1);
    expect(d.metrics.gross.cents).toBe(2268);
    expect(d.rows[0].reference).toBeTruthy();
    expect(d.metrics.newCustomers.count).toBe(1);
  }
});
