import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/commerce/runtime", () => ({
  readCommerce: vi.fn(async () => ({ accountId: "acct_synthetic", live: false })),
}));

import { prepareRefund, recordStockReturn, cancelPreparedRefund } from "./refunds";
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
