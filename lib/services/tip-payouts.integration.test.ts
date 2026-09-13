import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { deliveryTipFixture } from "@/tests/delivery-tip-fixture";
import { businessDate } from "@/lib/domain/operations";
const m = vi.hoisted(() => ({
  inspect: vi.fn(),
  report: vi.fn(),
  submit: vi.fn(),
  commerce: vi.fn(),
  qboCreate: vi.fn(),
  qboFind: vi.fn(),
  qboAccount: vi.fn(),
}));
vi.mock("@/lib/commerce/refund-provider", () => ({
  inspectStripeTipRefunds: m.inspect,
  submitClaimedStripeTipRefund: m.submit,
}));
vi.mock("@/lib/commerce/tax-report", () => ({ readRefundTaxEvidence: m.report }));
vi.mock("@/lib/commerce/runtime", () => ({ readCommerce: m.commerce }));
import {
  submitTipRefund,
  reconcileTipRefund,
  reconcileTipRefundEvent,
  retryUncertainTipRefund,
} from "./tip-refunds";
import type Stripe from "stripe";
import { matchTipRefundTax } from "./tip-refund-tax";
import { recordTipPayout, readTipAccounting } from "./tip-payouts";
beforeEach(() => {
  vi.resetAllMocks();
  m.inspect.mockResolvedValue({ disputed: false, refunds: [] });
  m.commerce.mockResolvedValue({ accountId: "acct_synthetic_receipt", live: false });
  vi.stubEnv("DD_TIP_REFUNDS_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());
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

it("matches one audited partial tax allocation across retries and pays only the remaining driver entitlement", async () => {
  const f = await fixture();
  const input = {
    tipId: f.tip.id,
    providerRefundId: "re_syntheticpartial",
    reportRunId: "frr_synthetic",
    taxCents: 4,
    confirmed: true,
  };
  m.inspect.mockResolvedValue({
    disputed: false,
    refunds: [
      {
        id: input.providerRefundId,
        amountCents: 54,
        currency: "USD",
        status: "succeeded",
        balanceTransactionId: "txn_synthetic",
      },
    ],
  });
  m.report.mockResolvedValue({
    originalTaxTransactionId: "tax_original",
    refundTaxTransactionId: "tax_reversal",
    taxCents: 4,
    reportRunId: input.reportRunId,
    fileId: "file_synthetic",
    reportHash: "a".repeat(64),
  });
  try {
    await expect(matchTipRefundTax(f.driver.id, input)).rejects.toMatchObject({
      status: 403,
    });
    expect(m.report).not.toHaveBeenCalled();
    expect((await readTipAccounting(f.userId, f.tip.id)).payableCents).toBe(0);
    const [a, b] = await Promise.all([
      matchTipRefundTax(f.userId, input),
      matchTipRefundTax(f.userId, input),
    ]);
    expect(a.id).toBe(b.id);
    expect(m.report).toHaveBeenCalledWith(
      input.reportRunId,
      expect.objectContaining({
        paymentIntentId: f.tip.paymentIntentId,
        sessionId: f.tip.stripeSessionId,
        refundCents: 54,
        refundTaxCents: 4,
      }),
    );
    expect(await readTipAccounting(f.userId, f.tip.id)).toMatchObject({
      refundedTipCents: 50,
      refundedTaxCents: 4,
      payableCents: 50,
      taxRefundEvidence: "MATCHED",
      review: false,
    });
    await expect(recordTipPayout(f.userId, f.input)).rejects.toMatchObject({
      status: 409,
    });
    await recordTipPayout(f.userId, { ...f.input, amountCents: 50 });
    expect((await readTipAccounting(f.userId, f.tip.id)).payableCents).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: f.tip.id, action: "delivery.tip.refund-tax.matched" },
      }),
    ).toBe(1);
    expect(await prisma.deliveryTip.findUnique({ where: { id: f.tip.id } })).toEqual(
      f.tip,
    );
    m.report.mockResolvedValueOnce({
      originalTaxTransactionId: "tax_original",
      refundTaxTransactionId: "tax_different",
      taxCents: 4,
      reportRunId: input.reportRunId,
      fileId: "file_synthetic",
      reportHash: "b".repeat(64),
    });
    await expect(matchTipRefundTax(f.userId, input)).rejects.toMatchObject({
      status: 409,
    });
  } finally {
    await f.cleanup();
  }
});
it("never saves tax allocation after a report mismatch or for a pending refund", async () => {
  const f = await fixture();
  const input = {
    tipId: f.tip.id,
    providerRefundId: "re_syntheticpartial",
    reportRunId: "frr_synthetic",
    taxCents: 4,
    confirmed: true,
  };
  try {
    m.inspect.mockResolvedValue({
      disputed: false,
      refunds: [
        {
          id: input.providerRefundId,
          amountCents: 54,
          currency: "USD",
          status: "pending",
          balanceTransactionId: null,
        },
      ],
    });
    await expect(matchTipRefundTax(f.userId, input)).rejects.toMatchObject({
      status: 409,
    });
    expect(m.report).not.toHaveBeenCalled();
    m.inspect.mockResolvedValue({
      disputed: false,
      refunds: [
        {
          id: input.providerRefundId,
          amountCents: 54,
          currency: "USD",
          status: "succeeded",
          balanceTransactionId: "txn_synthetic",
        },
      ],
    });
    m.report.mockRejectedValue(new Error("Synthetic report mismatch"));
    await expect(matchTipRefundTax(f.userId, input)).rejects.toThrow();
    expect(
      await prisma.auditLog.count({
        where: { entityId: f.tip.id, action: "delivery.tip.refund-tax.matched" },
      }),
    ).toBe(0);
    expect((await readTipAccounting(f.userId, f.tip.id)).payableCents).toBe(0);
  } finally {
    await f.cleanup();
  }
});

it("commits one refund claim before provider submission and preserves driver recovery and original records", async () => {
  const f = await fixture();
  const input = {
    tipId: f.tip.id,
    requestKey: randomUUID(),
    amountCents: 108,
    reason: "Synthetic requested refund",
    confirmed: true,
  };
  try {
    await recordTipPayout(f.userId, f.input);
    m.submit.mockImplementation(async (claim) => {
      expect(
        (
          await prisma.tipRefundRequest.findUniqueOrThrow({
            where: { id: claim.requestId },
          })
        ).state,
      ).toBe("SUBMITTING");
      const result = {
        id: "re_" + claim.requestId.replaceAll("_", ""),
        amountCents: 108,
        currency: "USD",
        status: "succeeded",
        balanceTransactionId: "txn_synthetic",
        requestId: claim.requestId,
        requestHash: claim.requestHash,
        project: "detergents-delivered",
      };
      m.inspect.mockResolvedValue({ disputed: false, refunds: [result] });
      return result;
    });
    await expect(submitTipRefund(f.driver.id, input)).rejects.toMatchObject({
      status: 403,
    });
    const [a, b] = await Promise.all([
      submitTipRefund(f.userId, input),
      submitTipRefund(f.userId, input),
    ]);
    expect(a.id).toBe(b.id);
    expect(m.submit).toHaveBeenCalledTimes(1);
    expect((await reconcileTipRefund(f.userId, a.id)).state).toBe("SUCCEEDED");
    expect(await readTipAccounting(f.userId, f.tip.id)).toMatchObject({
      recoverableCents: 100,
      payableCents: 0,
    });
    expect(await prisma.deliveryTip.findUnique({ where: { id: f.tip.id } })).toEqual(
      f.tip,
    );
    await expect(
      submitTipRefund(f.userId, { ...input, amountCents: 50 }),
    ).rejects.toMatchObject({ status: 409 });
    await submitTipRefund(f.userId, input);
    expect(m.submit).toHaveBeenCalledTimes(1);
  } finally {
    await f.cleanup();
  }
});
it("holds unknown refund capacity and recovers by provider lookup without a second POST", async () => {
  const f = await fixture();
  const input = {
    tipId: f.tip.id,
    requestKey: randomUUID(),
    amountCents: 54,
    reason: "Synthetic interrupted refund",
    confirmed: true,
  };
  try {
    m.submit.mockRejectedValue(new Error("Synthetic network interruption"));
    const result = await submitTipRefund(f.userId, input);
    expect(result.state).toBe("UNKNOWN");
    expect((await readTipAccounting(f.userId, f.tip.id)).payableCents).toBe(0);
    await expect(recordTipPayout(f.userId, f.input)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      submitTipRefund(f.userId, { ...input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await submitTipRefund(f.userId, input);
    expect(m.submit).toHaveBeenCalledTimes(1);
    await expect(reconcileTipRefund(f.userId, result.id)).rejects.toMatchObject({
      status: 409,
    });
    const saved = await prisma.tipRefundRequest.findUniqueOrThrow({
      where: { id: result.id },
    });
    m.inspect.mockResolvedValue({
      disputed: false,
      refunds: [
        {
          id: "re_" + saved.id.replaceAll("_", ""),
          amountCents: 54,
          currency: "USD",
          status: "succeeded",
          balanceTransactionId: "txn_synthetic",
          requestId: saved.id,
          requestHash: saved.requestHash,
          project: "detergents-delivered",
        },
      ],
    });
    const webhookRefund = {
      object: "refund",
      id: "re_" + saved.id.replaceAll("_", ""),
      payment_intent: saved.paymentIntentId,
      status: "pending", // Delayed event must not regress current provider state.
      metadata: {
        project: "detergents-delivered",
        tipId: saved.tipId,
        refundRequestId: saved.id,
        requestHash: saved.requestHash,
      },
    } satisfies Pick<
      Stripe.Refund,
      "id" | "object" | "metadata" | "payment_intent" | "status"
    >;
    const binding = { accountId: saved.accountId, live: saved.livemode };
    await reconcileTipRefundEvent(webhookRefund, binding);
    await reconcileTipRefundEvent(webhookRefund, binding);
    expect(
      (await prisma.tipRefundRequest.findUniqueOrThrow({ where: { id: saved.id } }))
        .state,
    ).toBe("SUCCEEDED");
    expect(
      await prisma.auditLog.count({
        where: { entityId: saved.id, action: "delivery.tip.refund.reconciled" },
      }),
    ).toBe(1);
    await expect(
      reconcileTipRefundEvent({ ...webhookRefund, payment_intent: "pi_wrong" }, binding),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      reconcileTipRefundEvent(webhookRefund, { ...binding, live: !binding.live }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      reconcileTipRefundEvent(webhookRefund, { ...binding, accountId: "acct_wrong" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.submit).toHaveBeenCalledTimes(1);
    expect((await readTipAccounting(f.userId, f.tip.id)).payableCents).toBe(0); // Partial tax still needs evidence.
  } finally {
    await f.cleanup();
  }
});
it("keeps submission disabled without activation and rejects amounts beyond unrefunded cash", async () => {
  const f = await fixture();
  const input = {
    tipId: f.tip.id,
    requestKey: randomUUID(),
    amountCents: 109,
    reason: "Synthetic invalid refund",
    confirmed: true,
  };
  try {
    vi.stubEnv("DD_TIP_REFUNDS_ENABLED", "false");
    await expect(
      submitTipRefund(f.userId, { ...input, amountCents: 108 }),
    ).rejects.toMatchObject({ status: 409 });
    vi.stubEnv("DD_TIP_REFUNDS_ENABLED", "true");
    await expect(submitTipRefund(f.userId, input)).rejects.toMatchObject({ status: 409 });
    expect(m.submit).not.toHaveBeenCalled();
    expect(await prisma.tipRefundRequest.count({ where: { tipId: f.tip.id } })).toBe(0);
  } finally {
    await f.cleanup();
  }
});

it("rolls back a tip refund claim when its permanent audit cannot be saved", async () => {
  const f = await fixture(),
    name = "tip_refund_audit_" + randomUUID().replaceAll("-", "");
  try {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType" = 'TipRefundRequest' AND NEW."actorUserId" = '${f.userId}' THEN RAISE EXCEPTION 'synthetic refund audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    await expect(
      submitTipRefund(f.userId, {
        tipId: f.tip.id,
        requestKey: randomUUID(),
        amountCents: 108,
        reason: "Synthetic audit failure",
        confirmed: true,
      }),
    ).rejects.toThrow();
    expect(m.submit).not.toHaveBeenCalled();
    expect(await prisma.tipRefundRequest.count({ where: { tipId: f.tip.id } })).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    await f.cleanup();
  }
});
it("does not let an older refund lookup overwrite a newer provider result", async () => {
  const f = await fixture();
  const input = {
    tipId: f.tip.id,
    requestKey: randomUUID(),
    amountCents: 108,
    reason: "Synthetic concurrent lookup",
    confirmed: true,
  };
  try {
    let observed: Record<string, unknown>;
    m.submit.mockImplementation(async (claim) => {
      observed = {
        id: "re_" + claim.requestId.replaceAll("_", ""),
        amountCents: 108,
        currency: "USD",
        status: "succeeded",
        balanceTransactionId: "txn_synthetic",
        requestId: claim.requestId,
        requestHash: claim.requestHash,
        project: "detergents-delivered",
      };
      m.inspect.mockResolvedValue({ disputed: false, refunds: [observed] });
      return observed;
    });
    const request = await submitTipRefund(f.userId, input);
    let release!: (v: unknown) => void, started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });
    m.inspect.mockImplementationOnce(() => {
      started();
      return held;
    });
    const older = reconcileTipRefund(f.userId, request.id);
    const rejection = expect(older).rejects.toMatchObject({ status: 409 });
    await began;
    await reconcileTipRefund(f.userId, request.id);
    release({ disputed: false, refunds: [{ ...observed!, status: "pending" }] });
    await rejection;
    expect(
      (await prisma.tipRefundRequest.findUniqueOrThrow({ where: { id: request.id } }))
        .state,
    ).toBe("SUCCEEDED");
  } finally {
    await f.cleanup();
  }
});

vi.mock("@/lib/integrations/quickbooks-client", () => ({
  quickbooksConfig: async () => ({
    mode: "sandbox",
    realm: "98765432",
    fingerprint: "synthetic-tip",
  }),
  readQuickbooksAccount: m.qboAccount,
  createQuickbooksCostJournal: m.qboCreate,
  findQuickbooksCostJournal: m.qboFind,
}));
vi.mock("./quickbooks-connection", () => ({
  authorizedQuickbooks: async () => ({
    config: { mode: "sandbox", realm: "98765432", fingerprint: "synthetic-tip" },
    accessToken: "synthetic",
  }),
  assertQuickbooksSnapshot: async (tx: typeof prisma, actor: string) => {
    const { financeAccess } = await import("./finance");
    await financeAccess(tx, actor, true);
  },
}));
import {
  prepareQuickbooksTipJournal,
  actQuickbooksTipJournal,
} from "./quickbooks-tip-journals";
const tipMapping = {
  collectionBank: "1",
  payoutBank: "2",
  tipLiability: "3",
  taxLiability: "4",
  driverReceivable: "5",
};
function qboSetup() {
  vi.stubEnv("DD_QBO_TIP_POSTING_ENABLED", "true");
  vi.stubEnv("DD_QBO_TIP_POSTING_COMPANY", "sandbox:98765432");
  m.qboAccount.mockImplementation(async (_c, _t, id) => ({
    Id: id,
    Active: true,
    CurrencyRef: { value: "USD" },
    AccountType: ["1", "2"].includes(id)
      ? "Bank"
      : id === "5"
        ? "Other Current Asset"
        : "Other Current Liability",
  }));
  m.qboCreate.mockImplementation(async (_c, _t, p) => ({
    ...p,
    Id: Date.now().toString() + Math.floor(Math.random() * 100000).toString(),
  }));
}
it("posts collection, driver payout and refunded-driver receivable as separate immutable adjusting journals", async () => {
  const f = await fixture();
  qboSetup();
  const prepare = () =>
    prepareQuickbooksTipJournal(f.userId, {
      tipId: f.tip.id,
      requestKey: randomUUID(),
      mapping: tipMapping,
      confirmed: true,
    });
  try {
    const first = await prepare();
    await actQuickbooksTipJournal(f.userId, { id: first.id, action: "SUBMIT" });
    await recordTipPayout(f.userId, f.input);
    const second = await prepare();
    expect(second.balances).toMatchObject({
      collectionBank: 108,
      payoutBank: -100,
      tipLiability: 0,
      taxLiability: 8,
    });
    await actQuickbooksTipJournal(f.userId, { id: second.id, action: "SUBMIT" });
    m.inspect.mockResolvedValue({
      disputed: false,
      refunds: [
        {
          id: "re_journal",
          amountCents: 108,
          currency: "USD",
          status: "succeeded",
          balanceTransactionId: "txn_journal",
        },
      ],
    });
    await expect(prepare()).rejects.toMatchObject({ status: 409 });
    m.report.mockResolvedValue({
      originalTaxTransactionId: "tax_original",
      refundTaxTransactionId: "tax_journal",
      taxCents: 8,
      reportRunId: "frr_journal",
      fileId: "file_journal",
      reportHash: "a".repeat(64),
    });
    await matchTipRefundTax(f.userId, {
      tipId: f.tip.id,
      providerRefundId: "re_journal",
      reportRunId: "frr_journal",
      taxCents: 8,
      confirmed: true,
    });
    const third = await prepare();
    expect(third.balances).toMatchObject({
      collectionBank: 0,
      payoutBank: -100,
      tipLiability: 0,
      taxLiability: 0,
      driverReceivable: 100,
    });
    await actQuickbooksTipJournal(f.userId, { id: third.id, action: "SUBMIT" });
    expect(m.qboCreate).toHaveBeenCalledTimes(3);
    await expect(
      prisma.qboTipJournal.update({
        where: { id: first.id },
        data: { payload: { tampered: true } },
      }),
    ).rejects.toThrow();
    await expect(prepare()).rejects.toMatchObject({ status: 409 });
  } finally {
    await f.cleanup();
  }
});
it("claims a tip journal once under concurrency and recovers lost responses by GET only", async () => {
  const f = await fixture();
  qboSetup();
  try {
    const d = {
      tipId: f.tip.id,
      requestKey: randomUUID(),
      mapping: tipMapping,
      confirmed: true,
    };
    await expect(prepareQuickbooksTipJournal(f.driver.id, d)).rejects.toMatchObject({
      status: 403,
    });
    const [a, b] = await Promise.all([
      prepareQuickbooksTipJournal(f.userId, d),
      prepareQuickbooksTipJournal(f.userId, d),
    ]);
    expect(a.id).toBe(b.id);
    m.qboCreate.mockRejectedValue(Error("synthetic lost response"));
    await prisma.deliveryTip.update({
      where: { id: f.tip.id },
      data: { recoveryCheckedAt: new Date() },
    });
    await Promise.allSettled([
      actQuickbooksTipJournal(f.userId, { id: a.id, action: "SUBMIT" }),
      actQuickbooksTipJournal(f.userId, { id: a.id, action: "SUBMIT" }),
    ]);
    expect(m.qboCreate).toHaveBeenCalledTimes(1);
    expect(
      (await prisma.qboTipJournal.findUniqueOrThrow({ where: { id: a.id } })).status,
    ).toBe("UNKNOWN");
    await expect(
      prepareQuickbooksTipJournal(f.userId, { ...d, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    m.qboFind.mockResolvedValue([
      { ...(a.payload as object), Id: Date.now().toString() },
    ]);
    expect(
      await actQuickbooksTipJournal(f.userId, { id: a.id, action: "RECONCILE" }),
    ).toMatchObject({ status: "POSTED" });
    expect(m.qboCreate).toHaveBeenCalledTimes(1);
  } finally {
    await f.cleanup();
  }
});
it("retries only the original tip refund key and rejects expired retry windows", async () => {
  const f = await fixture();
  try {
    m.submit.mockRejectedValue(Error("synthetic disconnected response"));
    const r = await submitTipRefund(f.userId, {
      tipId: f.tip.id,
      requestKey: randomUUID(),
      amountCents: 50,
      reason: "Synthetic failed response",
      confirmed: true,
    });
    await expect(
      retryUncertainTipRefund(f.userId, { id: r.id, confirmed: true }),
    ).rejects.toMatchObject({ status: 503 });
    expect(m.submit).toHaveBeenCalledTimes(2);
    expect(m.submit.mock.calls[1][0]).toEqual(m.submit.mock.calls[0][0]);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 24 * 3600000);
    await expect(
      retryUncertainTipRefund(f.userId, { id: r.id, confirmed: true }),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.submit).toHaveBeenCalledTimes(2);
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
});
