import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/commerce/runtime", () => ({
  readCommerce: vi.fn(async () => ({ accountId: "acct_synthetic", live: false })),
}));

import { prepareRefund, recordStockReturn } from "./refunds";

const marker = randomUUID();
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
        quantityOriginal: 3,
        quantityRemaining: 0,
        landedUnitCostCents: 400,
        receivedAt: new Date("2026-01-01T00:00:00Z"),
      },
    })
  ).id;
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
          create: { type: "checkout.session.completed", verifiedAt: new Date() },
        },
      },
    })
  ).id;
  await prisma.checkoutAttempt.create({
    data: {
      customerId: customer,
      requestKey: randomUUID(),
      requestHash: marker,
      snapshot: {},
      expiresAt: new Date(),
      stripeAccountId: "acct_synthetic",
      livemode: false,
      orderId: order,
      costs: {
        create: {
          costLayerId: layer,
          quantity: 3,
          unitCostCents: 400,
          state: "CONSUMED",
        },
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
  it("prepares exact cumulative refunds, replays a key and rejects CPA writes", async () => {
    const requestKey = randomUUID();
    const input = {
      requestKey,
      orderId: order,
      paymentId: payment,
      reason: "Customer requested a partial return",
      lines: [{ orderItemId: item, quantity: 1 }],
    };
    const first = await prepareRefund(admin, input);
    expect(first).toMatchObject({ amountCents: 1080, status: "PREPARED" });
    expect((await prepareRefund(admin, input)).id).toBe(first.id);
    await expect(
      prepareRefund(admin, { ...input, reason: "A different refund request reason" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      prepareRefund(cpa, { ...input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
    const second = await prepareRefund(admin, {
      ...input,
      requestKey: randomUUID(),
      lines: [{ orderItemId: item, quantity: 2 }],
    });
    expect(second.amountCents).toBe(2160);
    await expect(
      prepareRefund(admin, { ...input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.refundRequestEvent.count({ where: { refundRequestId: first.id } }),
    ).toBe(1);
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
  });
});
