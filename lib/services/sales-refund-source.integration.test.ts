import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { readCpaLedger } from "./cpa-ledger";
import { businessDate } from "@/lib/domain/operations";
import { reviewSalesRefundSource } from "./sales-refund-source";
let admin: string,
  cpa: string,
  customer: string,
  orderId: string,
  itemId: string,
  paymentId: string,
  checkoutId: string;
const users: string[] = [],
  marker = randomUUID(),
  address = {
    line1: "1 Synthetic Street",
    line2: "",
    city: "Synthetic",
    region: "IL",
    postalCode: "60000",
    country: "US",
  };
beforeAll(async () => {
  for (const code of ["ADMIN", "CPA", "CUSTOMER"] as const) {
    const role = await prisma.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      }),
      u = await prisma.user.create({
        data: {
          email: `source-${code}-${marker}@example.test`,
          userRoles: { create: { roleId: role.id } },
        },
      });
    users.push(u.id);
  }
  [admin, cpa] = users;
  customer = (
    await prisma.customer.create({ data: { userId: users[2], firstName: "Synthetic" } })
  ).id;
  const product = await prisma.product.create({
      data: {
        name: "Synthetic financial source",
        slug: marker,
        brand: "Synthetic",
        variants: { create: { sku: marker, name: "Synthetic pack" } },
      },
      include: { variants: true },
    }),
    variant = product.variants[0].id;
  const order = await prisma.order.create({
    data: {
      number: "source-" + marker,
      customerId: customer,
      status: "DELIVERED",
      placedAt: new Date("2026-02-01T18:00:00Z"),
      subtotalCents: 3000,
      discountCents: 900,
      taxCents: 168,
      totalCents: 2268,
      items: {
        create: {
          productVariantId: variant,
          nameSnapshot: "Original product",
          skuSnapshot: marker,
          quantity: 3,
          unitPriceCents: 1000,
          discountCents: 900,
          taxCents: 168,
          lineTotalCents: 2268,
        },
      },
    },
    include: { items: true },
  });
  orderId = order.id;
  itemId = order.items[0].id;
  checkoutId = randomUUID();
  const lines = [
    {
      variantId: variant,
      name: "Original product",
      sku: marker,
      quantity: 3,
      unitPriceCents: 1000,
      discountCents: 900,
      netCents: 2100,
      taxCode: "txcd_synthetic",
    },
  ];
  await prisma.checkoutAttempt.create({
    data: {
      id: checkoutId,
      customerId: customer,
      orderId,
      state: "PAID",
      requestKey: randomUUID(),
      requestHash: marker,
      expiresAt: new Date(),
      stripeAccountId: "acct_synthetic",
      stripeSessionId: "cs_" + marker,
      livemode: false,
      snapshot: {
        address,
        lines,
        subtotalCents: 3000,
        promotionCents: 300,
        rewardsCents: 600,
        taxCents: 168,
        totalCents: 2268,
        taxCalculationId: "taxcalc_" + marker,
        taxBreakdown: [{ amount: 168 }],
      },
    },
  });
  await prisma.taxCalculation.create({
    data: {
      orderId,
      provider: "STRIPE_QUOTE",
      destinationJson: address,
      taxableCents: 2100,
      taxCents: 168,
      externalId: "taxcalc_" + marker,
      breakdownJson: [{ amount: 168 }],
    },
  });
  paymentId = (
    await prisma.payment.create({
      data: {
        orderId,
        provider: "STRIPE",
        status: "CAPTURED",
        amountCents: 2268,
        externalId: "pi_" + marker,
        events: {
          create: {
            externalId: `checkout:${checkoutId}:paid`,
            type: "checkout.session.completed",
            verifiedAt: new Date(),
          },
        },
      },
    })
  ).id;
  const hold = await prisma.rewardReservation.create({
    data: {
      orderId,
      customerId: customer,
      amountCents: 600,
      orderTotalCents: 2868,
      requestKey: randomUUID(),
      state: "USED",
    },
  });
  await prisma.rewardEntry.create({
    data: {
      customerId: customer,
      orderId,
      sourceId: hold.id,
      kind: "REDEMPTION",
      amountCents: -600,
      description: "Synthetic accounting evidence",
      entryKey: `order:${orderId}:use`,
    },
  });
  await prisma.auditLog.create({
    data: {
      entityType: "Order",
      entityId: orderId,
      action: "checkout.payment.finalized",
      afterJson: {
        sessionId: "cs_" + marker,
        amount: 2268,
        currency: "usd",
        livemode: false,
        paymentStatus: "paid",
        status: "complete",
        rewardsUsedCents: 600,
        taxLines: [{ variantId: variant, netCents: 2100, taxCents: 168 }],
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
it("reconciles original price, discount, tax, payment and consumed reward evidence", async () => {
  const sale = await reviewSalesRefundSource(cpa, { orderId });
  expect(sale).toMatchObject({
    kind: "SALE",
    subtotalCents: 3000,
    promotionCents: 300,
    rewardsCents: 600,
    netCents: 2100,
    taxCents: 168,
    cashCents: 2268,
    date: "2026-02-01",
  });
  await expect(reviewSalesRefundSource(users[2], { orderId })).rejects.toMatchObject({
    status: 403,
  });
  const auditBefore = await prisma.auditLog.count({ where: { entityId: orderId } });
  await reviewSalesRefundSource(admin, { orderId });
  expect(await prisma.auditLog.count({ where: { entityId: orderId } })).toBe(auditBefore);
});
it("keeps unmatched refund tax separate from cash and reward settlement, then reads exact stored tax evidence", async () => {
  const request = await prisma.refundRequest.create({
    data: {
      orderId,
      paymentId,
      actorUserId: admin,
      requestKey: randomUUID(),
      requestHash: randomUUID(),
      amountCents: 756,
      currency: "USD",
      reason: "Synthetic source review",
      providerAccountId: "acct_synthetic",
      livemode: false,
      providerRefundId: "re_" + marker,
      status: "SUCCEEDED",
      submittedAt: new Date(),
      lines: {
        create: {
          orderItemId: itemId,
          quantity: 1,
          netCents: 700,
          taxCents: 56,
          rewardCents: 200,
        },
      },
      events: {
        create: {
          type: "refund.reconciled",
          status: "SUCCEEDED",
          verifiedAt: new Date(),
          evidenceJson: { providerRefundId: "re_" + marker, amountCents: 756 },
        },
      },
    },
  });
  const adjustment = await prisma.refundAdjustment.create({
    data: {
      requestId: request.id,
      kind: "SETTLEMENT",
      cashCents: 756,
      netCents: 700,
      taxCents: 56,
      rewardCents: 200,
      currency: "USD",
      providerRefundId: "re_" + marker,
      balanceTransactionId: "txn_synthetic",
    },
  });
  await prisma.rewardEntry.create({
    data: {
      customerId: customer,
      orderId,
      sourceId: request.id,
      kind: "RESTORE",
      amountCents: 200,
      description: "Synthetic accounting evidence",
      entryKey: `refund:${request.id}:restore`,
    },
  });
  expect(
    await reviewSalesRefundSource(cpa, { orderId, adjustmentId: adjustment.id }),
  ).toMatchObject({
    kind: "SETTLEMENT",
    cashCents: 756,
    rewardCents: 200,
    taxEvidenceStatus: "UNVERIFIED",
  });
  const evidence = await prisma.refundTaxEvidence.create({
    data: {
      adjustmentId: adjustment.id,
      providerAccountId: "acct_synthetic",
      livemode: false,
      reportRunId: "frr_synthetic",
      fileId: "file_synthetic",
      reportHash: "a".repeat(64),
      originalTaxTransactionId: "tax_sale_" + marker,
      refundTaxTransactionId: "tax_refund_" + marker,
      taxCents: 56,
      currency: "USD",
    },
  });
  expect(
    await reviewSalesRefundSource(cpa, { orderId, adjustmentId: adjustment.id }),
  ).toMatchObject({ taxEvidenceStatus: "MATCHED", taxEvidenceId: evidence.id });
  await prisma.refundRequest.update({
    where: { id: request.id },
    data: { status: "FAILED" },
  });
  await prisma.refundRequestEvent.create({
    data: {
      refundRequestId: request.id,
      type: "refund.reconciled",
      status: "FAILED",
      verifiedAt: new Date(),
    },
  });
  const compensation = await prisma.refundAdjustment.create({
    data: {
      requestId: request.id,
      kind: "COMPENSATION",
      cashCents: -756,
      netCents: -700,
      taxCents: -56,
      rewardCents: -200,
      currency: "USD",
      providerRefundId: "re_" + marker,
      failureBalanceTransactionId: "txn_failure",
    },
  });
  await prisma.rewardEntry.create({
    data: {
      customerId: customer,
      orderId,
      sourceId: request.id,
      kind: "REVERSAL",
      amountCents: -200,
      description: "Synthetic accounting evidence",
      entryKey: `refund:${request.id}:compensate`,
    },
  });
  expect(
    await reviewSalesRefundSource(cpa, { orderId, adjustmentId: compensation.id }),
  ).toMatchObject({
    kind: "COMPENSATION",
    cashCents: -756,
    rewardCents: -200,
    taxEvidenceStatus: "UNVERIFIED",
  });
  expect((await reviewSalesRefundSource(cpa, { orderId })).cashCents).toBe(2268);
});
it("rejects missing historical source and adjustments belonging to another order", async () => {
  const unknown = await prisma.order.create({
    data: {
      number: "missing-source-" + randomUUID(),
      customerId: customer,
      placedAt: new Date(),
    },
  });
  await expect(
    reviewSalesRefundSource(cpa, { orderId: unknown.id }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    reviewSalesRefundSource(cpa, { orderId, adjustmentId: randomUUID() }),
  ).rejects.toMatchObject({ status: 404 });
});

it("reports cross-period refund and compensation signs without rewriting sale or audit", async () => {
  const before = await prisma.auditLog.count({ where: { entityId: orderId } });
  const data = await readCpaLedger(cpa, {
    orderId,
    from: "2026-02-01",
    to: businessDate(),
  });
  expect(data.count).toBe(3);
  expect(data.totals).toMatchObject({
    cashCents: 2268,
    netCents: 2100,
    taxCents: 168,
    rewardCents: -600,
  });
  expect(data.rows.find((r) => r.kind === "SETTLEMENT")).toMatchObject({
    cashCents: -756,
    rewardCents: 200,
    taxEvidence: "MATCHED",
  });
  expect(data.rows.find((r) => r.kind === "COMPENSATION")).toMatchObject({
    cashCents: 756,
    rewardCents: -200,
    taxEvidence: "UNVERIFIED",
  });
  expect(data.missingCost).toBe(1);
  expect(data.merchandiseLessCostCents).toBeNull();
  const later = await readCpaLedger(
    admin,
    { orderId, from: businessDate(), to: businessDate() },
    true,
  );
  expect(later.count).toBe(2);
  expect(later.totals.cashCents).toBe(0);
  expect(later.totals.rewardCents).toBe(0);
  expect(await prisma.auditLog.count({ where: { entityId: orderId } })).toBe(before);
});
