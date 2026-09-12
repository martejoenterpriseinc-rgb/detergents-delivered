import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { deliveryTipFixture } from "@/tests/delivery-tip-fixture";
import { businessDate } from "@/lib/domain/operations";
const m = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock("@/lib/commerce/refund-provider", () => ({ inspectStripeTipRefunds: m.inspect }));
import { recordTipPayout, readTipAccounting } from "./tip-payouts";
beforeEach(() => {
  vi.resetAllMocks();
  m.inspect.mockResolvedValue({ disputed: false, refunds: [] });
});
afterAll(() => prisma.$disconnect());
async function fixture() {
  const f = await deliveryTipFixture(prisma);
  const role = await prisma.role.upsert({
    where: { code: "ADMIN" },
    create: { code: "ADMIN", name: "Admin" },
    update: {},
  });
  await prisma.userRole.create({ data: { userId: f.userId, roleId: role.id } });
  const id = "tip_" + randomUUID().replaceAll("-", "");
  const fields = {
    state: "PAID",
    taxCents: 8,
    totalCents: 108,
    paymentIntentId: `pi_${id}`,
    stripeSessionId: `cs_${id}`,
    stripeCustomerId: `cus_${id}`,
  };
  const tip = await prisma.deliveryTip.create({
    data: {
      id,
      orderId: f.orderId,
      deliveryAttemptId: f.attempt.id,
      requestKey: randomUUID(),
      requestHash: "synthetic",
      choice: "AMOUNT",
      baseCents: 2100,
      amountCents: 100,
      currency: "USD",
      source: { driverUserId: f.driver.id },
      stripeAccountId: "acct_synthetic_receipt",
      livemode: false,
      expiresAt: new Date(),
      paidAt: new Date(),
      ...fields,
    },
  });
  await prisma.auditLog.create({
    data: {
      entityType: "DeliveryTip",
      entityId: id,
      action: "delivery.tip.reconciled",
      afterJson: {
        ...fields,
        source: "stripe-api",
        accountId: tip.stripeAccountId,
        livemode: false,
      },
    },
  });
  return {
    ...f,
    tip,
    input: {
      tipId: id,
      requestKey: randomUUID(),
      amountCents: 100,
      reference: "synthetic-bank-" + randomUUID(),
      paidOn: businessDate(),
      reason: "Synthetic bank evidence verified",
      confirmed: true,
    },
  };
}
it("serializes duplicate payouts, prevents excess payments, preserves full reversals and separates order totals", async () => {
  const f = await fixture();
  try {
    const original = await prisma.order.findUnique({ where: { id: f.orderId } });
    await expect(recordTipPayout(f.driver.id, f.input)).rejects.toMatchObject({
      status: 403,
    });
    const [a, b] = await Promise.all([
      recordTipPayout(f.userId, f.input),
      recordTipPayout(f.userId, f.input),
    ]);
    expect(a.id).toBe(b.id);
    expect(await prisma.tipPayoutEntry.count({ where: { tipId: f.tip.id } })).toBe(1);
    await expect(
      recordTipPayout(f.userId, {
        ...f.input,
        requestKey: randomUUID(),
        reference: "another-transfer",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      recordTipPayout(f.userId, { ...f.input, amountCents: 50 }),
    ).rejects.toMatchObject({ status: 409 });
    const reverse = {
      ...f.input,
      requestKey: randomUUID(),
      reference: "returned-transfer",
      reversalOfId: a.id,
    };
    await recordTipPayout(f.userId, reverse);
    expect((await readTipAccounting(f.userId, f.tip.id)).payableCents).toBe(100);
    await expect(
      recordTipPayout(f.userId, {
        ...reverse,
        requestKey: randomUUID(),
        reference: "duplicate-return",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.order.findUnique({ where: { id: f.orderId } })).toEqual(original);
    expect(await prisma.deliveryTip.findUnique({ where: { id: f.tip.id } })).toEqual(
      f.tip,
    );
  } finally {
    await f.cleanup();
  }
});
it("exposes recovery after a full refund and blocks partial or disputed tip payouts", async () => {
  const f = await fixture();
  try {
    m.inspect.mockResolvedValue({ disputed: true, refunds: [] });
    await expect(recordTipPayout(f.userId, f.input)).rejects.toMatchObject({
      status: 409,
    });
    m.inspect.mockResolvedValue({ disputed: false, refunds: [] });
    await recordTipPayout(f.userId, f.input);
    m.inspect.mockResolvedValue({
      disputed: false,
      refunds: [
        {
          id: "re_synthetic",
          amountCents: 108,
          currency: "USD",
          status: "succeeded",
          balanceTransactionId: "txn_synthetic",
        },
      ],
    });
    expect(await readTipAccounting(f.userId, f.tip.id)).toMatchObject({
      recoverableCents: 100,
      payableCents: 0,
      refundedTipCents: 100,
    });
  } finally {
    await f.cleanup();
  }
});
it("rolls back the transfer if its permanent audit cannot be saved", async () => {
  const f = await fixture();
  const name = "tip_audit_" + randomUUID().replaceAll("-", "");
  try {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType" = 'TipPayoutEntry' AND NEW."actorUserId" = '${f.userId}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    await expect(recordTipPayout(f.userId, f.input)).rejects.toThrow();
    expect(await prisma.tipPayoutEntry.count({ where: { tipId: f.tip.id } })).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    await f.cleanup();
  }
});
