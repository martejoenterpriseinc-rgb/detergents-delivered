import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
const refundReviewMocks = vi.hoisted(() => ({ inspect: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/commerce/refund-provider", async (original) => ({
  ...(await original<typeof import("@/lib/commerce/refund-provider")>()),
  inspectStripeRefunds: refundReviewMocks.inspect,
  submitClaimedStripeRefund: refundReviewMocks.submit,
}));
import { reviewPaymentRefunds } from "./refund-review";

vi.mock("@/lib/commerce/runtime", () => ({
  readCommerce: vi.fn(async () => ({ accountId: "acct_synthetic", live: false })),
}));

import {
  prepareRefund,
  recordStockReturn,
  cancelPreparedRefund,
  claimRefundSubmission,
  recordRefundSubmissionResult,
  submitPreparedRefund,
} from "./refunds";
import { getOrder } from "./order-workspace";

const marker = randomUUID();
const checkoutId = randomUUID();
const users: string[] = [];
let admin: string,
  cpa: string,
  customer: string,
  order: string,
  item: string,
  payment: string,
  variant: string,
  layer: string;

beforeAll(async () => {
  for (const code of ["ADMIN", "CPA", "CUSTOMER"] as const) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    const user = await prisma.user.create({
      data: {
        email: `refund-${code.toLowerCase()}-${marker}@example.test`,
        userRoles: { create: { roleId: role.id } },
      },
    });
    users.push(user.id);
  }
  [admin, cpa] = users;
  customer = (
    await prisma.customer.create({ data: { userId: users[2], firstName: marker } })
  ).id;
  const savedProduct = await prisma.product.create({
    data: {
      name: "Synthetic return product",
      brand: "Synthetic",
      slug: marker,
      variants: { create: { name: "Three pack", sku: marker } },
    },
    include: { variants: true },
  });
  variant = savedProduct.variants[0].id;
  await prisma.inventoryBalance.create({ data: { productVariantId: variant } });
  layer = (
    await prisma.inventoryCostLayer.create({
      data: {
        productVariantId: variant,
        quantityOriginal: 1,
        quantityRemaining: 0,
        landedUnitCostCents: 400,
        receivedAt: new Date("2026-01-01T00:00:00Z"),
      },
    })
  ).id;
  const otherLayers = await Promise.all(
    [500, 600].map((cost, index) =>
      prisma.inventoryCostLayer.create({
        data: {
          productVariantId: variant,
          quantityOriginal: 1,
          quantityRemaining: 0,
          landedUnitCostCents: cost,
          receivedAt: new Date(`2026-01-0${index + 2}T00:00:00Z`),
        },
      }),
    ),
  );
  const savedOrder = await prisma.order.create({
    data: {
      number: `refund-${marker}`,
      customerId: customer,
      status: "DELIVERED",
      subtotalCents: 3000,
      taxCents: 240,
      totalCents: 3240,
      items: {
        create: {
          productVariantId: variant,
          nameSnapshot: "Historical product",
          skuSnapshot: marker,
          quantity: 3,
          unitPriceCents: 1000,
          taxCents: 240,
          lineTotalCents: 3240,
        },
      },
    },
    include: { items: true },
  });
  order = savedOrder.id;
  item = savedOrder.items[0].id;
  payment = (
    await prisma.payment.create({
      data: {
        orderId: order,
        provider: "STRIPE",
        status: "CAPTURED",
        amountCents: 3240,
        externalId: `pi_${marker}`,
        events: {
          create: {
            type: "checkout.session.completed",
            externalId: `checkout:${checkoutId}:paid`,
            verifiedAt: new Date(),
          },
        },
      },
    })
  ).id;
  await prisma.checkoutAttempt.create({
    data: {
      id: checkoutId,
      state: "PAID",
      customerId: customer,
      requestKey: randomUUID(),
      requestHash: marker,
      snapshot: {},
      expiresAt: new Date(),
      stripeAccountId: "acct_synthetic",
      livemode: false,
      orderId: order,
      costs: {
        create: [
          {
            costLayerId: layer,
            quantity: 1,
            unitCostCents: 400,
            state: "CONSUMED",
          },
          ...otherLayers.map((cost) => ({
            costLayerId: cost.id,
            quantity: 1,
            unitCostCents: cost.landedUnitCostCents,
            state: "CONSUMED" as const,
          })),
        ],
      },
    },
  });
});

afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: users } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});

describe("read-only refund review (isolated PostgreSQL, mock provider)", () => {
  const observed = () => ({
    paymentIntentId: `pi_${marker}`,
    chargeId: "ch_synthetic",
    accountId: "acct_synthetic",
    live: false,
    capturedCents: 3240,
    currency: "USD",
    disputed: false,
    refunds: [],
  });
  it("allows admin and CPA inspection without changing payment, stock or audit records", async () => {
    refundReviewMocks.inspect.mockResolvedValue(observed());
    const before = await prisma.payment.findUnique({
      where: { id: payment },
      include: { refunds: true },
    });
    const stock = await prisma.inventoryBalance.findUnique({
      where: { productVariantId: variant },
    });
    const audits = await prisma.auditLog.count();
    for (const actor of [admin, cpa]) {
      const result = await reviewPaymentRefunds(actor, {
        orderId: order,
        paymentId: payment,
      });
      expect(result).toMatchObject({
        providerRefundCount: 0,
        succeededCents: 0,
        pendingCents: 0,
        unresolvedRequests: 0,
      });
      expect(JSON.stringify(result)).not.toContain("acct_");
      expect(JSON.stringify(result)).not.toContain("pi_");
    }
    expect(
      await prisma.payment.findUnique({
        where: { id: payment },
        include: { refunds: true },
      }),
    ).toEqual(before);
    expect(
      await prisma.inventoryBalance.findUnique({ where: { productVariantId: variant } }),
    ).toEqual(stock);
    expect(await prisma.auditLog.count()).toBe(audits);
  });
  it("rejects customers and cross-order payments before provider calls", async () => {
    refundReviewMocks.inspect.mockClear();
    await expect(
      reviewPaymentRefunds(users[2], { orderId: order, paymentId: payment }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      reviewPaymentRefunds(admin, { orderId: "other", paymentId: payment }),
    ).rejects.toMatchObject({ status: 404 });
    expect(refundReviewMocks.inspect).not.toHaveBeenCalled();
  });
  it("reports changed provider status and uncertain submissions without releasing them", async () => {
    const saved = await Promise.all(
      [1, 2].map((index) =>
        prisma.refundRequest.create({
          data: {
            orderId: order,
            paymentId: payment,
            actorUserId: admin,
            requestKey: randomUUID(),
            requestHash: `review-${index}-${marker}`,
            amountCents: 100,
            currency: "USD",
            reason: "Synthetic provider evidence review",
            providerAccountId: "acct_synthetic",
            livemode: false,
            status: "UNKNOWN",
            submittedAt: new Date(),
          },
        }),
      ),
    );
    try {
      refundReviewMocks.inspect.mockResolvedValueOnce({
        ...observed(),
        disputed: true,
        refunds: [
          {
            id: "re_synthetic",
            amountCents: 100,
            currency: "USD",
            status: "pending",
            created: 1780000000,
            requestId: saved[0].id,
            requestHash: saved[0].requestHash,
            project: "detergents-delivered",
            balanceTransactionId: null,
            failureBalanceTransactionId: null,
          },
        ],
      });
      const result = await reviewPaymentRefunds(admin, {
        orderId: order,
        paymentId: payment,
      });
      expect(result).toMatchObject({
        pendingCents: 100,
        succeededCents: 0,
        changedRequests: 1,
        unresolvedRequests: 1,
        disputed: true,
      });
      for (const request of saved)
        expect(
          await prisma.refundRequest.findUnique({ where: { id: request.id } }),
        ).toEqual(request);
    } finally {
      await prisma.refundRequest.deleteMany({
        where: { id: { in: saved.map((r) => r.id) } },
      });
    }
  });
  it("rejects changed payment records while the provider request is running", async () => {
    refundReviewMocks.inspect.mockImplementationOnce(async () => {
      await prisma.payment.update({
        where: { id: payment },
        data: { status: "PARTIALLY_REFUNDED" },
      });
      return observed();
    });
    try {
      await expect(
        reviewPaymentRefunds(admin, { orderId: order, paymentId: payment }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await prisma.payment.update({
        where: { id: payment },
        data: { status: "CAPTURED" },
      });
    }
  });
  it("rechecks access after the provider read", async () => {
    refundReviewMocks.inspect.mockImplementationOnce(async () => {
      await prisma.user.update({ where: { id: cpa }, data: { deletedAt: new Date() } });
      return observed();
    });
    try {
      await expect(
        reviewPaymentRefunds(cpa, { orderId: order, paymentId: payment }),
      ).rejects.toThrow();
    } finally {
      await prisma.user.update({ where: { id: cpa }, data: { deletedAt: null } });
    }
  });
  it("rejects external refunds and propagates provider failure without writes", async () => {
    refundReviewMocks.inspect.mockResolvedValueOnce({
      ...observed(),
      refunds: [{ id: "re_external" }],
    });
    await expect(
      reviewPaymentRefunds(admin, { orderId: order, paymentId: payment }),
    ).rejects.toMatchObject({ status: 409 });
    refundReviewMocks.inspect.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(
      reviewPaymentRefunds(admin, { orderId: order, paymentId: payment }),
    ).rejects.toThrow("Provider unavailable");
    expect(await prisma.refundRequest.count({ where: { orderId: order } })).toBe(0);
  });
});

describe("durable refund submission claim (isolated PostgreSQL, no provider writes)", () => {
  async function fixture() {
    const id = randomUUID();
    const sale = await prisma.order.create({
      data: {
        number: `claim-${id}`,
        customerId: customer,
        status: "DELIVERED",
        subtotalCents: 3000,
        taxCents: 240,
        totalCents: 3240,
        items: {
          create: {
            productVariantId: variant,
            nameSnapshot: "Saved product",
            skuSnapshot: id,
            quantity: 3,
            unitPriceCents: 1000,
            taxCents: 240,
            lineTotalCents: 3240,
          },
        },
        checkoutAttempt: {
          create: {
            id,
            customerId: customer,
            state: "PAID",
            requestKey: id,
            requestHash: id,
            snapshot: {},
            expiresAt: new Date(),
            stripeAccountId: "acct_synthetic",
            livemode: false,
          },
        },
        payments: {
          create: {
            provider: "STRIPE",
            status: "CAPTURED",
            amountCents: 3240,
            externalId: `pi_${id.replaceAll("-", "")}`,
            events: {
              create: {
                type: "checkout.session.completed",
                externalId: `checkout:${id}:paid`,
                verifiedAt: new Date(),
              },
            },
          },
        },
      },
      include: { items: true, payments: true },
    });
    const prepare = () =>
      prepareRefund(admin, {
        requestKey: randomUUID(),
        orderId: sale.id,
        paymentId: sale.payments[0].id,
        reason: "Customer requested partial refund",
        lines: [{ orderItemId: sale.items[0].id, quantity: 1 }],
      });
    const draft = await prepare();
    return { sale, draft, prepare, input: { orderId: sale.id, requestId: draft.id } };
  }
  async function claimedFixture() {
    const f = await fixture();
    const claim = await claimRefundSubmission(admin, f.input);
    const observation = {
      id: `re_${randomUUID().replaceAll("-", "")}`,
      amountCents: claim.amountCents,
      currency: claim.binding.currency,
      status: "succeeded" as const,
      created: Math.floor(Date.now() / 1000),
      requestId: claim.requestId,
      requestHash: claim.requestHash,
      project: "detergents-delivered" as const,
      balanceTransactionId: "txn_synthetic",
      failureBalanceTransactionId: null,
    };
    return { ...f, observation, outcome: { ...f.input, observation } };
  }
  it("orchestrates one provider attempt after the claim commits and records its receipt", async () => {
    const f = await fixture();
    refundReviewMocks.submit.mockReset();
    refundReviewMocks.submit.mockImplementation(async (claim) => {
      expect(
        (await prisma.refundRequest.findUniqueOrThrow({ where: { id: f.draft.id } }))
          .status,
      ).toBe("SUBMITTING");
      return {
        id: `re_${randomUUID().replaceAll("-", "")}`,
        amountCents: claim.amountCents,
        currency: claim.binding.currency,
        status: "pending",
        created: Math.floor(Date.now() / 1000),
        requestId: claim.requestId,
        requestHash: claim.requestHash,
        project: "detergents-delivered",
        balanceTransactionId: null,
        failureBalanceTransactionId: null,
      };
    });
    const attempts = await Promise.allSettled([
      submitPreparedRefund(admin, f.input),
      submitPreparedRefund(admin, f.input),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(refundReviewMocks.submit).toHaveBeenCalledTimes(1);
    expect(
      await prisma.refundRequest.findUniqueOrThrow({ where: { id: f.draft.id } }),
    ).toMatchObject({
      status: "UNKNOWN",
      providerRefundId: expect.stringMatching(/^re_/),
    });
    expect(await prisma.refund.count({ where: { orderId: f.sale.id } })).toBe(0);
  });
  it("records a provider timeout without exposing errors or retrying the create", async () => {
    const f = await fixture();
    refundReviewMocks.submit
      .mockReset()
      .mockRejectedValue(new Error("Private synthetic provider error"));
    const result = await submitPreparedRefund(admin, f.input);
    expect(result.status).toBe("UNKNOWN");
    expect(JSON.stringify(result)).not.toContain("Private synthetic");
    await expect(submitPreparedRefund(admin, f.input)).rejects.toMatchObject({
      status: 409,
    });
    expect(refundReviewMocks.submit).toHaveBeenCalledTimes(1);
    const event = await prisma.refundRequestEvent.findFirstOrThrow({
      where: { refundRequestId: f.draft.id, type: "refund.submission.unconfirmed" },
    });
    expect(event.evidenceJson).toEqual({ outcome: "unconfirmed" });
    expect(event.verifiedAt).toBeNull();
  });
  it("records a receipt once under concurrent retries without settling cash or stock", async () => {
    const f = await claimedFixture();
    const stock = await prisma.inventoryBalance.findUnique({
      where: { productVariantId: variant },
    });
    const results = await Promise.all([
      recordRefundSubmissionResult(admin, f.outcome),
      recordRefundSubmissionResult(admin, f.outcome),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].status).toBe("UNKNOWN");
    expect(JSON.stringify(results)).not.toContain(f.observation.id);
    expect(JSON.stringify(results)).not.toContain(f.observation.requestHash);
    expect(
      await prisma.refundRequestEvent.count({
        where: { refundRequestId: f.draft.id, type: "refund.submission.observed" },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: f.draft.id, action: "refund.submission.outcome-recorded" },
      }),
    ).toBe(1);
    expect(
      (await prisma.refundRequest.findUniqueOrThrow({ where: { id: f.draft.id } }))
        .providerRefundId,
    ).toBe(f.observation.id);
    expect(await prisma.refund.count({ where: { orderId: f.sale.id } })).toBe(0);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: f.sale.payments[0].id } }))
        .status,
    ).toBe("CAPTURED");
    expect(
      await prisma.inventoryBalance.findUnique({ where: { productVariantId: variant } }),
    ).toEqual(stock);
  });
  it("keeps a timeout reserved, accepts a later receipt, and ignores a delayed timeout", async () => {
    const f = await claimedFixture();
    await recordRefundSubmissionResult(admin, { ...f.input, observation: null });
    await recordRefundSubmissionResult(admin, { ...f.input, observation: null });
    expect(
      await prisma.refundRequestEvent.count({
        where: { refundRequestId: f.draft.id, type: "refund.submission.unconfirmed" },
      }),
    ).toBe(1);
    await expect(claimRefundSubmission(admin, f.input)).rejects.toMatchObject({
      status: 409,
    });
    await recordRefundSubmissionResult(admin, f.outcome);
    const before = await prisma.refundRequest.findUniqueOrThrow({
      where: { id: f.draft.id },
    });
    await recordRefundSubmissionResult(admin, { ...f.input, observation: null });
    expect(
      await prisma.refundRequest.findUniqueOrThrow({ where: { id: f.draft.id } }),
    ).toEqual(before);
  });
  it("preserves success and later failure observations without releasing the reservation", async () => {
    const f = await claimedFixture();
    await recordRefundSubmissionResult(admin, f.outcome);
    await recordRefundSubmissionResult(admin, {
      ...f.outcome,
      observation: {
        ...f.observation,
        status: "failed",
        failureBalanceTransactionId: "txn_returned",
      },
    });
    const events = await prisma.refundRequestEvent.findMany({
      where: { refundRequestId: f.draft.id, type: "refund.submission.observed" },
    });
    expect(events).toHaveLength(2);
    expect(
      events
        .map((e) => (e.evidenceJson as { providerStatus: string }).providerStatus)
        .sort(),
    ).toEqual(["failed", "succeeded"]);
    expect(
      (await prisma.refundRequest.findUniqueOrThrow({ where: { id: f.draft.id } }))
        .status,
    ).toBe("UNKNOWN");
  });
  it("rejects wrong roles, unsubmitted requests and mismatched provider receipts", async () => {
    const f = await claimedFixture();
    for (const actor of [cpa, users[2]])
      await expect(recordRefundSubmissionResult(actor, f.outcome)).rejects.toMatchObject({
        status: 403,
      });
    for (const patch of [
      { amountCents: 1081 },
      { currency: "EUR" },
      { requestId: "other" },
      { requestHash: "b".repeat(64) },
    ])
      await expect(
        recordRefundSubmissionResult(admin, {
          ...f.outcome,
          observation: { ...f.observation, ...patch },
        }),
      ).rejects.toMatchObject({ status: 409 });
    await expect(
      recordRefundSubmissionResult(admin, {
        ...f.outcome,
        observation: { ...f.observation, instructions_email: "private@example.test" },
      }),
    ).rejects.toThrow();
    const unsubmitted = await fixture();
    await expect(
      recordRefundSubmissionResult(admin, { ...unsubmitted.input, observation: null }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects replacement provider identifiers and cannot downgrade settled requests", async () => {
    const f = await claimedFixture();
    await recordRefundSubmissionResult(admin, f.outcome);
    await expect(
      recordRefundSubmissionResult(admin, {
        ...f.outcome,
        observation: { ...f.observation, id: "re_other" },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await prisma.refundRequest.update({
      where: { id: f.draft.id },
      data: { status: "SUCCEEDED" },
    });
    await expect(
      recordRefundSubmissionResult(admin, { ...f.input, observation: null }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rolls back receipt, provider binding and status if the audit cannot be saved", async () => {
    const f = await claimedFixture();
    await prisma.$executeRawUnsafe(
      "ALTER TABLE \"AuditLog\" ADD CONSTRAINT dd_refund_outcome_audit CHECK (action <> 'refund.submission.outcome-recorded') NOT VALID",
    );
    try {
      await expect(recordRefundSubmissionResult(admin, f.outcome)).rejects.toThrow();
      expect(
        await prisma.refundRequest.findUniqueOrThrow({ where: { id: f.draft.id } }),
      ).toMatchObject({ status: "SUBMITTING", providerRefundId: null });
      expect(
        await prisma.refundRequestEvent.count({
          where: { refundRequestId: f.draft.id, type: "refund.submission.observed" },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" DROP CONSTRAINT dd_refund_outcome_audit',
      );
    }
  });
  it("allows exactly one claim under concurrency and preserves payment and stock", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      claimRefundSubmission(admin, f.input),
      claimRefundSubmission(admin, f.input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const saved = await prisma.refundRequest.findUniqueOrThrow({
      where: { id: f.draft.id },
    });
    expect(saved.status).toBe("SUBMITTING");
    expect(saved.submittedAt).not.toBeNull();
    expect(
      await prisma.refundRequestEvent.count({
        where: { refundRequestId: saved.id, type: "refund.submission.claimed" },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: saved.id, action: "refund.submission.claimed" },
      }),
    ).toBe(1);
    expect(await prisma.refund.count({ where: { orderId: f.sale.id } })).toBe(0);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: f.sale.payments[0].id } }))
        .status,
    ).toBe("CAPTURED");
    await expect(
      cancelPreparedRefund(admin, {
        ...f.input,
        reason: "Cannot cancel a submitted request",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects CPA/customer claims and cross-order requests", async () => {
    const f = await fixture();
    for (const actor of [cpa, users[2]])
      await expect(claimRefundSubmission(actor, f.input)).rejects.toMatchObject({
        status: 403,
      });
    await expect(
      claimRefundSubmission(admin, { ...f.input, orderId: "other" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await prisma.refundRequest.findUniqueOrThrow({ where: { id: f.draft.id } }))
        .submittedAt,
    ).toBeNull();
  });
  it("atomically rolls back the claim when its audit fails", async () => {
    const f = await fixture();
    await prisma.$executeRawUnsafe(
      "ALTER TABLE \"AuditLog\" ADD CONSTRAINT dd_refund_claim_audit CHECK (action <> 'refund.submission.claimed') NOT VALID",
    );
    try {
      await expect(claimRefundSubmission(admin, f.input)).rejects.toThrow();
      expect(
        await prisma.refundRequest.findUniqueOrThrow({ where: { id: f.draft.id } }),
      ).toMatchObject({ status: "PREPARED", submittedAt: null });
      expect(
        await prisma.refundRequestEvent.count({ where: { refundRequestId: f.draft.id } }),
      ).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" DROP CONSTRAINT dd_refund_claim_audit',
      );
    }
  });
  it("blocks altered allocations and payment identity before claiming", async () => {
    const f = await fixture();
    await prisma.refundRequest.update({
      where: { id: f.draft.id },
      data: { amountCents: 1081 },
    });
    await expect(claimRefundSubmission(admin, f.input)).rejects.toMatchObject({
      status: 409,
    });
    await prisma.refundRequest.update({
      where: { id: f.draft.id },
      data: { amountCents: 1080, livemode: true },
    });
    await expect(claimRefundSubmission(admin, f.input)).rejects.toMatchObject({
      status: 409,
    });
    await prisma.refundRequest.update({
      where: { id: f.draft.id },
      data: { livemode: false, requestHash: "changed" },
    });
    await expect(claimRefundSubmission(admin, f.input)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      (await prisma.refundRequest.findUniqueOrThrow({ where: { id: f.draft.id } }))
        .submittedAt,
    ).toBeNull();
  });
  it("blocks a second request while a prior outcome is unknown, including delayed retries", async () => {
    const f = await fixture();
    const next = await f.prepare();
    await claimRefundSubmission(admin, f.input);
    await prisma.refundRequest.update({
      where: { id: f.draft.id },
      data: { status: "UNKNOWN", submittedAt: new Date("2026-01-01") },
    });
    await expect(claimRefundSubmission(admin, f.input)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      claimRefundSubmission(admin, { orderId: f.sale.id, requestId: next.id }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("serializes draft cancellation against the submission claim", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      claimRefundSubmission(admin, f.input),
      cancelPreparedRefund(admin, {
        ...f.input,
        reason: "Customer withdrew the refund request",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const saved = await prisma.refundRequest.findUniqueOrThrow({
      where: { id: f.draft.id },
    });
    expect(["SUBMITTING", "CANCELED"]).toContain(saved.status);
    expect(saved.submittedAt !== null).toBe(saved.status === "SUBMITTING");
  });
});

describe("refund reservations and physical returns (isolated PostgreSQL)", () => {
  it("replaces a canceled partial draft without losing or exceeding saved net and tax cents", async () => {
    const id = randomUUID();
    const sale = await prisma.order.create({
      data: {
        number: `rounding-${id}`,
        customerId: customer,
        status: "DELIVERED",
        subtotalCents: 1000,
        taxCents: 83,
        totalCents: 1083,
        items: {
          create: {
            productVariantId: variant,
            nameSnapshot: "Saved price",
            skuSnapshot: id,
            quantity: 3,
            unitPriceCents: 334,
            taxCents: 83,
            lineTotalCents: 1083,
          },
        },
        checkoutAttempt: {
          create: {
            id,
            customerId: customer,
            state: "PAID",
            requestKey: id,
            requestHash: id,
            snapshot: {},
            expiresAt: new Date(),
            stripeAccountId: "acct_synthetic",
            livemode: false,
          },
        },
        payments: {
          create: {
            provider: "STRIPE",
            status: "CAPTURED",
            amountCents: 1083,
            externalId: `pi_${id}`,
            events: {
              create: {
                type: "checkout.session.completed",
                externalId: `checkout:${id}:paid`,
                verifiedAt: new Date(),
              },
            },
          },
        },
      },
      include: { items: true, payments: true },
    });
    const prepare = (quantity: number) =>
      prepareRefund(admin, {
        requestKey: randomUUID(),
        orderId: sale.id,
        paymentId: sale.payments[0].id,
        reason: "Review partial refund for saved merchandise",
        lines: [{ orderItemId: sale.items[0].id, quantity }],
      });
    const first = await prepare(1);
    const second = await prepare(2);
    await cancelPreparedRefund(admin, {
      orderId: sale.id,
      requestId: first.id,
      reason: "Correct the first draft before submission",
    });
    const replacement = await prepare(1);
    expect(second.amountCents + replacement.amountCents).toBe(1083);
    const lines = await prisma.refundRequestLine.findMany({
      where: {
        refundRequestId: { in: [second.id, replacement.id] },
      },
    });
    expect(lines.reduce((sum, line) => sum + line.netCents, 0)).toBe(1000);
    expect(lines.reduce((sum, line) => sum + line.taxCents, 0)).toBe(83);
    await expect(prepare(1)).rejects.toMatchObject({ status: 409 });
  });
  it("cancels unused drafts once, releases capacity and rolls back a failed audit", async () => {
    const draft = await prepareRefund(admin, {
      requestKey: randomUUID(),
      orderId: order,
      paymentId: payment,
      reason: "Initial refund draft awaiting review",
      lines: [{ orderItemId: item, quantity: 3 }],
    });
    const input = {
      orderId: order,
      requestId: draft.id,
      reason: "Customer decided to keep the purchased goods",
    };
    await expect(cancelPreparedRefund(cpa, input)).rejects.toMatchObject({ status: 403 });
    await expect(
      cancelPreparedRefund(admin, { ...input, orderId: "wrong-order" }),
    ).rejects.toMatchObject({ status: 404 });
    await prisma.$executeRawUnsafe(
      "ALTER TABLE \"AuditLog\" ADD CONSTRAINT dd_refund_cancel_audit CHECK (action <> 'refund.draft.canceled') NOT VALID",
    );
    try {
      await expect(cancelPreparedRefund(admin, input)).rejects.toThrow();
      expect(
        (await prisma.refundRequest.findUniqueOrThrow({ where: { id: draft.id } }))
          .status,
      ).toBe("PREPARED");
      expect(
        await prisma.refundRequestEvent.count({ where: { refundRequestId: draft.id } }),
      ).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" DROP CONSTRAINT dd_refund_cancel_audit',
      );
    }
    for (const status of [
      "SUBMITTING",
      "UNKNOWN",
      "PENDING",
      "REQUIRES_ACTION",
      "SUCCEEDED",
      "FAILED",
    ] as const) {
      await prisma.refundRequest.update({ where: { id: draft.id }, data: { status } });
      await expect(cancelPreparedRefund(admin, input)).rejects.toMatchObject({
        status: 409,
      });
    }
    await prisma.refundRequest.update({
      where: { id: draft.id },
      data: { status: "PREPARED", submittedAt: new Date() },
    });
    await expect(cancelPreparedRefund(admin, input)).rejects.toMatchObject({
      status: 409,
    });
    await prisma.refundRequest.update({
      where: { id: draft.id },
      data: { submittedAt: null },
    });
    const results = await Promise.all([
      cancelPreparedRefund(admin, input),
      cancelPreparedRefund(admin, input),
    ]);
    expect(results.map((result) => result.status)).toEqual(["CANCELED", "CANCELED"]);
    expect(
      await prisma.refundRequestEvent.count({
        where: { refundRequestId: draft.id, type: "refund.draft.canceled" },
      }),
    ).toBe(1);
    expect(await prisma.refund.count({ where: { orderId: order } })).toBe(0);
  });
  it("prepares exact cumulative refunds, replays a key and rejects CPA writes", async () => {
    const requestKey = randomUUID();
    const input = {
      requestKey,
      orderId: order,
      paymentId: payment,
      reason: "Customer requested a partial return",
      lines: [{ orderItemId: item, quantity: 1 }],
    };
    await prisma.payment.update({
      where: { id: payment },
      data: { status: "AUTHORIZED" },
    });
    await expect(prepareRefund(admin, input)).rejects.toMatchObject({ status: 409 });
    await prisma.payment.update({ where: { id: payment }, data: { status: "CAPTURED" } });
    const [first, replay] = await Promise.all([
      prepareRefund(admin, input),
      prepareRefund(admin, input),
    ]);
    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({ amountCents: 1080, status: "PREPARED" });
    expect(Object.keys(first).sort()).toEqual(
      [
        "id",
        "orderId",
        "paymentId",
        "amountCents",
        "currency",
        "reason",
        "status",
        "createdAt",
      ].sort(),
    );
    expect((await prepareRefund(admin, input)).id).toBe(first.id);
    await expect(
      prepareRefund(admin, { ...input, reason: "A different refund request reason" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      prepareRefund(cpa, { ...input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
    const competing = await Promise.allSettled(
      [1, 2].map(() =>
        prepareRefund(admin, {
          ...input,
          requestKey: randomUUID(),
          lines: [{ orderItemId: item, quantity: 2 }],
        }),
      ),
    );
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const succeeded = competing.find((result) => result.status === "fulfilled");
    if (succeeded?.status === "fulfilled") expect(succeeded.value.amountCents).toBe(2160);
    const rejected = competing.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected")
      expect(rejected.reason).toMatchObject({ status: 409 });
    await expect(
      prepareRefund(admin, { ...input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.refundRequestEvent.count({ where: { refundRequestId: first.id } }),
    ).toBe(1);
    await expect(
      prisma.refundRequestEvent.updateMany({
        where: { refundRequestId: first.id },
        data: { type: "rewritten" },
      }),
    ).rejects.toThrow();
  });

  it("records sellable and damaged goods separately without creating refunds", async () => {
    const sellable = await recordStockReturn(admin, {
      requestKey: randomUUID(),
      orderId: order,
      reason: "One unopened unit was received back",
      lines: [{ orderItemId: item, quantity: 1, condition: "SELLABLE" }],
    });
    expect(
      (
        await recordStockReturn(admin, {
          requestKey: (
            await prisma.stockReturn.findUniqueOrThrow({ where: { id: sellable.id } })
          ).requestKey,
          orderId: order,
          reason: "One unopened unit was received back",
          lines: [{ orderItemId: item, quantity: 1, condition: "SELLABLE" }],
        })
      ).id,
    ).toBe(sellable.id);
    await recordStockReturn(admin, {
      requestKey: randomUUID(),
      orderId: order,
      reason: "One leaking unit was received damaged",
      lines: [{ orderItemId: item, quantity: 1, condition: "DAMAGED" }],
    });
    expect(
      await prisma.inventoryBalance.findUniqueOrThrow({
        where: { productVariantId: variant },
      }),
    ).toMatchObject({ onHandQty: 1, damagedQty: 1 });
    expect(
      (await prisma.inventoryCostLayer.findUniqueOrThrow({ where: { id: layer } }))
        .quantityRemaining,
    ).toBe(1);
    expect(await prisma.refund.count({ where: { orderId: order } })).toBe(0);
    await expect(
      recordStockReturn(admin, {
        requestKey: randomUUID(),
        orderId: order,
        reason: "Too many units claimed as physically returned",
        lines: [{ orderItemId: item, quantity: 2, condition: "SELLABLE" }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    const finalInput = {
      requestKey: randomUUID(),
      orderId: order,
      reason: "Final unopened unit received after damaged unit",
      lines: [{ orderItemId: item, quantity: 1, condition: "SELLABLE" }],
    };
    const [finalReturn, repeated] = await Promise.all([
      recordStockReturn(admin, finalInput),
      recordStockReturn(admin, finalInput),
    ]);
    expect(repeated.id).toBe(finalReturn.id);
    const costs = await prisma.inventoryCostLayer.findMany({
      where: { productVariantId: variant },
      orderBy: { receivedAt: "asc" },
    });
    expect(costs.map((cost) => cost.quantityRemaining)).toEqual([1, 0, 1]);
    const returnedLine = await prisma.stockReturnLine.findFirstOrThrow({
      where: { stockReturnId: finalReturn.id },
    });
    expect(returnedLine.costEvidence).toEqual([
      expect.objectContaining({
        costLayerId: costs[2].id,
        quantity: 1,
        unitCostCents: 600,
      }),
    ]);
    await expect(
      prisma.stockReturnLine.update({
        where: { id: returnedLine.id },
        data: { quantity: 2 },
      }),
    ).rejects.toThrow();
    const detail = await getOrder(cpa, order);
    expect(detail.canReceiveReturn).toBe(false);
    expect(detail.items[0].returnedQuantity).toBe(3);
    expect(detail.stockReturns).toHaveLength(3);
    expect(detail.refundRequests.every((request) => !request.canCancel)).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("providerRefundId");
    expect(JSON.stringify(detail)).not.toContain("requestHash");
    expect(JSON.stringify(detail)).not.toContain("costLayerId");
  });
});
