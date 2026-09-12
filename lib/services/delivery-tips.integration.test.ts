import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { deliveryTipFixture } from "@/tests/delivery-tip-fixture";
import { tipSession } from "@/tests/tip-session-fixture";
import { readTipReport } from "./tip-report";
import { businessDate } from "@/lib/domain/operations";
const mocks = vi.hoisted(() => ({ config: vi.fn(), create: vi.fn(), retrieve: vi.fn() }));
vi.mock("@/lib/commerce/tip-provider", () => ({
  tipConfiguration: mocks.config,
  createTipSession: mocks.create,
  retrieveTipSession: mocks.retrieve,
}));
import {
  beginDeliveryTip,
  readDeliveryTips,
  reconcileOwnedDeliveryTip,
  recoverDeliveryTips,
} from "./delivery-tips";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockResolvedValue({
    accountId: "acct_synthetic_receipt",
    live: false,
    taxCode: "txcd_00000000",
  });
  mocks.create.mockImplementation(async (t) => ({
    session: tipSession(t.id, t.amountCents),
    customerId: `cus_${t.id}`,
  }));
  mocks.retrieve.mockImplementation(async (t) => tipSession(t.id, t.amountCents));
});
afterAll(() => prisma.$disconnect());
it("settles a separate tip once under duplicate requests without changing sale, payment or rewards", async () => {
  const f = await deliveryTipFixture(prisma);
  try {
    const original = await prisma.order.findUnique({
      where: { id: f.orderId },
      include: { items: true, payments: true, rewardEntries: true, taxCalculation: true },
    });
    const d = {
      orderId: f.orderId,
      requestKey: randomUUID(),
      choice: "PERCENT",
      percent: 15,
    };
    await expect(beginDeliveryTip(f.driver.id, d)).rejects.toMatchObject({ status: 403 });
    const [a, b] = await Promise.all([
      beginDeliveryTip(f.userId, d),
      beginDeliveryTip(f.userId, d),
    ]);
    expect(a.id).toBe(b.id);
    expect(await prisma.deliveryTip.count({ where: { orderId: f.orderId } })).toBe(1);
    await expect(
      beginDeliveryTip(f.userId, { ...d, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(beginDeliveryTip(f.userId, { ...d, percent: 20 })).rejects.toMatchObject(
      { status: 409 },
    );
    mocks.retrieve.mockImplementation(async (t) => tipSession(t.id, t.amountCents, true));
    await Promise.all([
      reconcileOwnedDeliveryTip(f.userId, a.id),
      reconcileOwnedDeliveryTip(f.userId, a.id),
    ]);
    expect((await readDeliveryTips(f.userId, f.orderId)).tips[0]).toMatchObject({
      state: "PAID",
      amountCents: 315,
      taxCents: 25,
      totalCents: 340,
    });
    await expect(readTipReport(f.userId, {})).rejects.toMatchObject({ status: 403 });
    const cpa = await prisma.role.upsert({
      where: { code: "CPA" },
      create: { code: "CPA", name: "CPA" },
      update: {},
    });
    await prisma.userRole.create({ data: { userId: f.driver.id, roleId: cpa.id } });
    const report = await readTipReport(f.driver.id, {
      from: businessDate(),
      to: businessDate(),
    });
    expect(report.rows.find((r) => r.id === a.id)).toMatchObject({
      verified: true,
      tipCents: 315,
      taxCents: 25,
      totalCents: 340,
      driverUserId: f.driver.id,
    });
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: a.id,
          action: "delivery.tip.reconciled",
          afterJson: { path: ["state"], equals: "PAID" },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.order.findUnique({
        where: { id: f.orderId },
        include: {
          items: true,
          payments: true,
          rewardEntries: true,
          taxCalculation: true,
        },
      }),
    ).toEqual(original);
  } finally {
    await f.cleanup();
  }
});
it("requires owned confirmed delivery, retains declined choices and keeps uncertain payments protected", async () => {
  const f = await deliveryTipFixture(prisma);
  try {
    const d = { orderId: f.orderId, requestKey: randomUUID(), choice: "DECLINE" };
    await prisma.deliveryAttempt.update({
      where: { id: f.attempt.id },
      data: { result: "FAILED" },
    });
    await expect(beginDeliveryTip(f.userId, d)).rejects.toMatchObject({ status: 409 });
    await prisma.deliveryAttempt.update({
      where: { id: f.attempt.id },
      data: { result: "DELIVERED" },
    });
    const no = await beginDeliveryTip(f.userId, d);
    expect(no.state).toBe("DECLINED");
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await beginDeliveryTip(f.userId, d)).id).toBe(no.id);
    const yes = { ...d, requestKey: randomUUID(), choice: "AMOUNT", amountCents: 500 };
    mocks.create.mockRejectedValueOnce(Error("Synthetic lost response"));
    await expect(beginDeliveryTip(f.userId, yes)).rejects.toThrow();
    expect((await readDeliveryTips(f.userId, f.orderId)).tips[0].state).toBe("UNKNOWN");
    await expect(
      beginDeliveryTip(f.userId, { ...yes, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    const retry = await beginDeliveryTip(f.userId, yes);
    expect(retry.state).toBe("OPEN");
    await expect(recoverDeliveryTips(async () => false)).rejects.toThrow(/lease/);
  } finally {
    await f.cleanup();
  }
});
it("rolls back the tip decision when its audit fails before any provider call", async () => {
  const f = await deliveryTipFixture(prisma);
  try {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION dd_tip_audit_test_fail() RETURNS trigger AS $$ BEGIN IF NEW.action = 'delivery.tip.requested' THEN RAISE EXCEPTION 'synthetic tip audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER dd_tip_audit_test_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION dd_tip_audit_test_fail()`,
    );
    await expect(
      beginDeliveryTip(f.userId, {
        orderId: f.orderId,
        requestKey: randomUUID(),
        choice: "AMOUNT",
        amountCents: 500,
      }),
    ).rejects.toThrow();
    expect(await prisma.deliveryTip.count({ where: { orderId: f.orderId } })).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS dd_tip_audit_test_fail ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS dd_tip_audit_test_fail()");
    await f.cleanup();
  }
});
it("retains a paid provider observation for retry when the settlement audit fails", async () => {
  const f = await deliveryTipFixture(prisma);
  try {
    const tip = await beginDeliveryTip(f.userId, {
      orderId: f.orderId,
      requestKey: randomUUID(),
      choice: "AMOUNT",
      amountCents: 500,
    });
    mocks.retrieve.mockImplementation(async (t) => tipSession(t.id, t.amountCents, true));
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION dd_tip_settlement_test_fail() RETURNS trigger AS $$ BEGIN IF NEW.action = 'delivery.tip.reconciled' THEN RAISE EXCEPTION 'synthetic tip settlement audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER dd_tip_settlement_test_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION dd_tip_settlement_test_fail()`,
    );
    await expect(reconcileOwnedDeliveryTip(f.userId, tip.id)).rejects.toThrow();
    expect(await prisma.deliveryTip.findUnique({ where: { id: tip.id } })).toMatchObject({
      state: "OPEN",
      paidAt: null,
      paymentIntentId: null,
    });
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER dd_tip_settlement_test_fail ON "AuditLog"',
    );
    await reconcileOwnedDeliveryTip(f.userId, tip.id);
    expect(await prisma.deliveryTip.findUnique({ where: { id: tip.id } })).toMatchObject({
      state: "PAID",
      amountCents: 500,
      totalCents: 525,
    });
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS dd_tip_settlement_test_fail ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS dd_tip_settlement_test_fail()",
    );
    await f.cleanup();
  }
});
