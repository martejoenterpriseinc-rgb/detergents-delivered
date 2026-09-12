import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { manualPaymentFixture } from "@/tests/manual-payment-fixture";
import {
  readManualPaymentApprovals,
  saveManualPaymentApproval,
  assertManualPaymentApproval,
} from "./manual-payment-approvals";
afterAll(() => prisma.$disconnect());
const input = (customerId: string) => ({
  customerId,
  requestKey: randomUUID(),
  method: "CASH" as const,
  enabled: true,
  version: 0,
  maxOrderCents: 10000,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  reason: "Approved limited payment exception",
});
it("restricts decisions to staff, deduplicates concurrent saves, revokes immediately and never creates a sale", async () => {
  const f = await manualPaymentFixture(prisma);
  try {
    const d = input(f.customer.id);
    for (const u of [f.cpa, f.buyer, f.driver])
      await expect(saveManualPaymentApproval(u.id, d)).rejects.toMatchObject({
        status: 403,
      });
    await expect(
      readManualPaymentApprovals(f.buyer.id, f.customer.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      Promise.all([
        saveManualPaymentApproval(f.admin.id, d),
        saveManualPaymentApproval(f.admin.id, d),
      ]),
    ).resolves.toEqual([{ version: 1 }, { version: 1 }]);
    expect((await readManualPaymentApprovals(f.cpa.id, f.customer.id)).canWrite).toBe(
      false,
    );
    expect(
      await prisma.manualPaymentApproval.count({ where: { customerId: f.customer.id } }),
    ).toBe(1);
    await expect(
      saveManualPaymentApproval(f.admin.id, { ...d, reason: "Different reused request" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      saveManualPaymentApproval(f.admin.id, { ...d, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      prisma.$transaction((tx) =>
        assertManualPaymentApproval(tx, f.customer.id, "CASH", 10000),
      ),
    ).resolves.toMatchObject({ approvalVersion: 1 });
    await expect(
      prisma.$transaction((tx) =>
        assertManualPaymentApproval(tx, f.customer.id, "CASH", 10001),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      prisma.$transaction((tx) =>
        assertManualPaymentApproval(tx, f.customer.id, "ZELLE", 100),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await saveManualPaymentApproval(f.admin.id, {
      ...d,
      requestKey: randomUUID(),
      version: 1,
      enabled: false,
      reason: "Customer no longer needs this method",
    });
    await expect(
      prisma.$transaction((tx) =>
        assertManualPaymentApproval(tx, f.customer.id, "CASH", 100),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(0);
    expect(
      await prisma.checkoutAttempt.count({ where: { customerId: f.customer.id } }),
    ).toBe(0);
    expect(
      (await readManualPaymentApprovals(f.cpa.id, f.customer.id)).history,
    ).toHaveLength(2);
  } finally {
    await f.cleanup();
  }
});
it("rejects expired/unverified approvals and rechecks eligibility when using an approval", async () => {
  const f = await manualPaymentFixture(prisma);
  try {
    const d = input(f.customer.id);
    await expect(
      saveManualPaymentApproval(f.admin.id, {
        ...d,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      saveManualPaymentApproval(f.admin.id, {
        ...d,
        expiresAt: new Date(Date.now() + 91 * 86400000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await prisma.customer.update({
      where: { id: f.customer.id },
      data: { purchaseApprovedAt: null },
    });
    await expect(saveManualPaymentApproval(f.admin.id, d)).rejects.toMatchObject({
      status: 409,
    });
    await prisma.customer.update({
      where: { id: f.customer.id },
      data: { purchaseApprovedAt: new Date() },
    });
    await saveManualPaymentApproval(f.admin.id, d);
    await prisma.user.update({
      where: { id: f.buyer.id },
      data: { emailVerified: null },
    });
    await expect(
      prisma.$transaction((tx) =>
        assertManualPaymentApproval(tx, f.customer.id, "CASH", 100),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await prisma.user.update({
      where: { id: f.buyer.id },
      data: { emailVerified: new Date() },
    });
    await prisma.manualPaymentApproval.updateMany({
      where: { customerId: f.customer.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      prisma.$transaction((tx) =>
        assertManualPaymentApproval(tx, f.customer.id, "CASH", 100),
      ),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    await f.cleanup();
  }
});
it("rolls back the approval if its permanent audit cannot be written", async () => {
  const f = await manualPaymentFixture(prisma);
  try {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION dd_manual_approval_test_fail() RETURNS trigger AS $$ BEGIN IF NEW.action = 'manual-payment.approval.saved' THEN RAISE EXCEPTION 'synthetic approval audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER dd_manual_approval_test_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION dd_manual_approval_test_fail()`,
    );
    await expect(
      saveManualPaymentApproval(f.admin.id, input(f.customer.id)),
    ).rejects.toThrow();
    expect(
      await prisma.manualPaymentApproval.count({ where: { customerId: f.customer.id } }),
    ).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS dd_manual_approval_test_fail ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS dd_manual_approval_test_fail()",
    );
    await f.cleanup();
  }
});
