import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { receiptFixture } from "@/tests/customer-receipt-fixture";
import { prepareManualRefund, recordManualRefund } from "./manual-refunds";
import { reconcileManualRefundTax } from "./manual-refund-tax";
import { recordedSaleSource, recordedRefundSource } from "./sales-refund-source";
import { readTaxReview } from "./tax-review";
const provider = vi.hoisted(() => vi.fn());
const fixtureUsers: string[] = [];
vi.mock("@/lib/commerce/manual-refund-tax", () => ({
  executeManualTaxReversal: provider,
}));
beforeEach(() => {
  vi.stubEnv("DD_MANUAL_REFUNDS_ENABLED", "true");
  vi.stubEnv("DD_MANUAL_REFUND_TAX_ENABLED", "true");
  provider.mockReset();
});
afterEach(async () => {
  await prisma.user.updateMany({
    where: { id: { in: fixtureUsers.splice(0) } },
    data: { deletedAt: new Date() },
  });
  vi.unstubAllEnvs();
});
async function fixture(method: "CASH" | "ZELLE" = "CASH") {
  const f = await receiptFixture(prisma, { financialEvidence: true, manual: method });
  fixtureUsers.push(f.userId);
  const role = await prisma.role.upsert({
    where: { code: "ADMIN" },
    update: {},
    create: { code: "ADMIN", name: "Admin" },
  });
  await prisma.userRole.create({ data: { userId: f.userId, roleId: role.id } });
  const sale = await prisma.$transaction((tx) => recordedSaleSource(tx, f.orderId));
  const draft = () =>
    prepareManualRefund(f.userId, {
      orderId: f.orderId,
      paymentId: sale.paymentId,
      requestKey: randomUUID(),
      reason: "Synthetic partial item refund",
      lines: [{ orderItemId: sale.lines[0].orderItemId, quantity: 1 }],
    });
  const returned = (id: string, reference = "synthetic-" + randomUUID()) => ({
    orderId: f.orderId,
    requestId: id,
    method,
    reference,
    amountCents: 756,
    reason: "Verified synthetic return receipt",
    returnedAt: new Date().toISOString(),
    confirmed: true,
  });
  return { ...f, sale, draft, returned };
}
it.each(["CASH", "ZELLE"] as const)(
  "conserves cash, tax and rewards across partial %s refunds and rejects receipt reuse",
  async (method) => {
    const f = await fixture(method);
    const first = await f.draft(),
      receipt = f.returned(first.id);
    await Promise.all([
      recordManualRefund(f.userId, receipt),
      recordManualRefund(f.userId, receipt),
    ]);
    const second = await f.draft();
    await expect(
      recordManualRefund(f.userId, f.returned(second.id, receipt.reference)),
    ).rejects.toMatchObject({ status: 409 });
    await recordManualRefund(f.userId, f.returned(second.id));
    const third = await f.draft();
    await recordManualRefund(f.userId, f.returned(third.id));
    await expect(f.draft()).rejects.toMatchObject({ status: 409 });
    const a = await prisma.refundAdjustment.findMany({
      where: { request: { orderId: f.orderId } },
    });
    expect(a.reduce((n, r) => n + r.cashCents, 0)).toBe(2268);
    expect(a.reduce((n, r) => n + r.taxCents, 0)).toBe(168);
    expect(a.reduce((n, r) => n + r.rewardCents, 0)).toBe(600);
    expect(
      await prisma.rewardEntry.count({ where: { orderId: f.orderId, kind: "RESTORE" } }),
    ).toBe(3);
    expect(await prisma.$transaction((tx) => recordedSaleSource(tx, f.orderId))).toEqual(
      f.sale,
    );
    expect(provider).not.toHaveBeenCalled();
  },
);
it("rolls back the whole return when its permanent audit cannot be stored", async () => {
  const f = await fixture(),
    r = await f.draft(),
    d = f.returned(r.id);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT dd_manual_refund_test_audit CHECK (action <> 'manual-refund.returned') NOT VALID`,
  );
  try {
    await expect(recordManualRefund(f.userId, d)).rejects.toThrow();
    expect(await prisma.refund.count({ where: { requestId: r.id } })).toBe(0);
    expect(await prisma.refundAdjustment.count({ where: { requestId: r.id } })).toBe(0);
    expect(
      await prisma.refundRequestEvent.count({
        where: { refundRequestId: r.id, type: "manual-refund.returned" },
      }),
    ).toBe(0);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: f.sale.paymentId } }))
        .status,
    ).toBe("CAPTURED");
  } finally {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AuditLog" DROP CONSTRAINT dd_manual_refund_test_audit`,
    );
  }
  await recordManualRefund(f.userId, d);
  expect(await prisma.refund.count({ where: { requestId: r.id } })).toBe(1);
});
it("retains a tax claim through uncertainty and permits only exact GET recovery", async () => {
  const f = await fixture(),
    r = await f.draft();
  await recordManualRefund(f.userId, f.returned(r.id));
  const d = { orderId: f.orderId, requestId: r.id, confirmed: true };
  provider.mockRejectedValueOnce(new Error("synthetic unknown outcome"));
  await expect(reconcileManualRefundTax(f.userId, d)).rejects.toMatchObject({
    status: 409,
  });
  await expect(reconcileManualRefundTax(f.userId, d)).rejects.toMatchObject({
    status: 409,
  });
  expect(provider).toHaveBeenCalledTimes(1);
  const taxId = "tax_refund" + randomUUID().replaceAll("-", "");
  provider.mockImplementation(async (b) => ({
    originalTaxTransactionId: b.originalTransactionId,
    refundTaxTransactionId: taxId,
    postedAt: Math.floor(Date.now() / 1000),
    taxLines: b.refundLines.map(
      (l: { orderItemId: string; netCents: number; taxCents: number }) => ({
        orderItemId: l.orderItemId,
        originalLineItemId: "tax_li_synthetic",
        netCents: l.netCents,
        taxCents: l.taxCents,
      }),
    ),
  }));
  await reconcileManualRefundTax(f.userId, { ...d, taxTransactionId: taxId });
  expect(provider.mock.calls[1][1]).toBe(taxId);
  await reconcileManualRefundTax(f.userId, d);
  expect(provider).toHaveBeenCalledTimes(2);
  const a = await prisma.refundAdjustment.findFirstOrThrow({
    where: { requestId: r.id },
  });
  expect(
    await prisma.$transaction((tx) => recordedRefundSource(tx, f.orderId, a.id)),
  ).toMatchObject({
    taxEvidenceStatus: "MATCHED",
    refundTaxTransactionId: taxId,
    taxCents: 56,
    providerRefundId: null,
  });
  expect(await prisma.refund.count({ where: { requestId: r.id } })).toBe(1);
  expect(
    await prisma.rewardEntry.count({ where: { orderId: f.orderId, kind: "RESTORE" } }),
  ).toBe(1);
});
it("blocks unaccepted live activation and CPA writes without provider calls", async () => {
  const f = await fixture();
  vi.stubEnv("APP_ENV", "production");
  await expect(f.draft()).rejects.toMatchObject({ status: 503 });
  vi.stubEnv("APP_ENV", "development");
  const admin = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  await prisma.userRole.delete({
    where: { userId_roleId: { userId: f.userId, roleId: admin.id } },
  });
  const role = await prisma.role.upsert({
    where: { code: "CPA" },
    update: {},
    create: { code: "CPA", name: "CPA" },
  });
  await prisma.userRole.create({ data: { userId: f.userId, roleId: role.id } });
  await expect(f.draft()).rejects.toMatchObject({ status: 403 });
  expect(provider).not.toHaveBeenCalled();
});
it("keeps tax review available when a manual refund source needs evidence review", async () => {
  const f = await fixture(),
    r = await f.draft();
  await recordManualRefund(f.userId, f.returned(r.id));
  await prisma.payment.update({
    where: { id: f.sale.paymentId },
    data: { amountCents: 1 },
  });
  const adjustment = await prisma.refundAdjustment.findFirstOrThrow({
    where: { requestId: r.id },
  });
  const report = await readTaxReview(f.userId, {});
  expect(report.rows.find((row) => row.id === adjustment.id)).toMatchObject({
    evidence: "Manual refund evidence requires review",
    canMatch: false,
  });
  expect(report.unverifiedAdjustments).toBeGreaterThan(0);
  expect(provider).not.toHaveBeenCalled();
});

it("retries aged manual refund tax only after independent review and preserves the original binding", async () => {
  const f = await fixture(),
    reviewer = await fixture(),
    r = await f.draft();
  await recordManualRefund(f.userId, f.returned(r.id));
  const d = { orderId: f.orderId, requestId: r.id, confirmed: true };
  provider.mockRejectedValueOnce(new Error("synthetic lost tax response"));
  await expect(reconcileManualRefundTax(f.userId, d)).rejects.toMatchObject({
    status: 409,
  });
  const originalBinding = provider.mock.calls[0][0];
  const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 49 * 3600000);
  try {
    await expect(
      reconcileManualRefundTax(f.userId, { ...d, retryReviewed: true }),
    ).rejects.toMatchObject({ status: 409 });
    const runtime = await import("@/lib/commerce/runtime");
    const config = vi
      .spyOn(runtime, "readCommerce")
      .mockResolvedValue({
        accountId: originalBinding.accountId,
        live: originalBinding.live,
      } as Awaited<ReturnType<typeof runtime.readCommerce>>);
    const { proposeClaimReview, decideClaimReview } =
      await import("./financial-claim-reviews");
    const review = await proposeClaimReview(f.userId, {
      kind: "MANUAL_REFUND_TAX",
      claimId: r.id,
      requestKey: randomUUID(),
      providerCase: "case-tax-synthetic",
      evidenceReference: "retained/tax-confirmation.pdf",
      evidenceSha256: "d".repeat(64),
      statement:
        "Synthetic provider confirms original tax reversal was never created and attempts have ended.",
      reviewedThrough: new Date(Date.now() - 1000).toISOString(),
      confirmed: true,
    });
    await decideClaimReview(reviewer.userId, {
      id: review.id,
      decision: "APPROVED",
      reason: "Independently verified original tax reference and provider confirmation",
      confirmed: true,
    });
    const taxId = "tax_reviewed" + randomUUID().replaceAll("-", "");
    provider.mockImplementation(async (b, id, authorize) => {
      expect(id).toBeUndefined();
      await authorize();
      return {
        originalTaxTransactionId: b.originalTransactionId,
        refundTaxTransactionId: taxId,
        postedAt: Math.floor(Date.now() / 1000),
        taxLines: b.refundLines.map(
          (l: { orderItemId: string; netCents: number; taxCents: number }) => ({
            ...l,
            originalLineItemId: "tax_li_synthetic",
          }),
        ),
      };
    });
    await reconcileManualRefundTax(f.userId, { ...d, retryReviewed: true });
    expect(provider.mock.calls[1][0]).toEqual(originalBinding);
    await reconcileManualRefundTax(f.userId, { ...d, retryReviewed: true });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(await prisma.refund.count({ where: { requestId: r.id } })).toBe(1);
    config.mockRestore();
  } finally {
    time.mockRestore();
  }
});
