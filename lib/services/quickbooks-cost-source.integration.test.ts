import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { reviewOrderCost, costOrderChoices } from "./quickbooks-cost-source";
import { recordStockReturn } from "./refunds";
const marker = randomUUID();
const checkoutId = randomUUID();
const users: string[] = [];
let admin: string,
  cpa: string,
  customer: string,
  order: string,
  item: string,
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
        email: `cost-review-${code.toLowerCase()}-${marker}@example.test`,
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
      number: `cost-review-${marker}`,
      customerId: customer,
      status: "DELIVERED",
      placedAt: new Date("2026-02-01T18:00:00Z"),
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
  });
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
it("reads exact consumed FIFO sale cost with finance permissions and no provider access", async () => {
  const cost = await reviewOrderCost(cpa, { orderId: order });
  expect(cost).toMatchObject({ kind: "SALE", amountCents: 1500, date: "2026-02-01" });
  expect(cost.pieces.map((p) => p.unitCostCents).sort()).toEqual([400, 500, 600]);
  expect((await costOrderChoices(admin)).rows.some((r) => r.id === order)).toBe(true);
  await expect(reviewOrderCost(users[2], { orderId: order })).rejects.toMatchObject({
    status: 403,
  });
});
it("values partial sellable returns from original layers and excludes damaged stock", async () => {
  const restored = await recordStockReturn(admin, {
    requestKey: randomUUID(),
    orderId: order,
    reason: "Synthetic cost review",
    lines: [{ orderItemId: item, quantity: 1, condition: "SELLABLE" }],
  });
  expect(
    await reviewOrderCost(cpa, { orderId: order, returnId: restored.id }),
  ).toMatchObject({ kind: "RETURN", amountCents: 400 });
  const damaged = await recordStockReturn(admin, {
    requestKey: randomUUID(),
    orderId: order,
    reason: "Synthetic damaged return",
    lines: [{ orderItemId: item, quantity: 1, condition: "DAMAGED" }],
  });
  expect(
    await reviewOrderCost(cpa, { orderId: order, returnId: damaged.id }),
  ).toMatchObject({ kind: "RETURN", amountCents: 0, pieces: [] });
  await expect(
    reviewOrderCost(cpa, { orderId: order, returnId: randomUUID() }),
  ).rejects.toMatchObject({ status: 404 });
  expect((await reviewOrderCost(cpa, { orderId: order })).amountCents).toBe(1500);
});
it("blocks an order without verified payment evidence and refuses another environment", async () => {
  const unpaid = await prisma.order.create({
    data: {
      number: "unpaid-cost-" + randomUUID(),
      customerId: customer,
      placedAt: new Date(),
    },
  });
  await expect(reviewOrderCost(cpa, { orderId: unpaid.id })).rejects.toMatchObject({
    status: 409,
  });
  const before = process.env.APP_ENV;
  process.env.APP_ENV = "production";
  try {
    await expect(reviewOrderCost(cpa, { orderId: order })).rejects.toMatchObject({
      status: 409,
    });
  } finally {
    process.env.APP_ENV = before;
  }
});
