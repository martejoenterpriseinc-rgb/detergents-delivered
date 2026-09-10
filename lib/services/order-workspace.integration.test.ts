import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOrder, listOrders } from "./order-workspace";

const marker = randomUUID();
const users: string[] = [];
let admin: string,
  cpa: string,
  employee: string,
  customer: string,
  variant: string,
  product: string,
  paid: string,
  pending: string;
beforeAll(async () => {
  for (const code of ["ADMIN", "CPA", "INVENTORY", "CUSTOMER"] as const) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    const user = await prisma.user.create({
      data: {
        email: `orders-${code}-${marker}@example.test`,
        userRoles: { create: { roleId: role.id } },
      },
    });
    users.push(user.id);
  }
  [admin, cpa, employee] = users;
  customer = (
    await prisma.customer.create({
      data: { userId: users[3], firstName: marker, lastName: "Order test" },
    })
  ).id;
  const p = await prisma.product.create({
    data: {
      name: "Current product",
      slug: marker,
      brand: "Synthetic",
      variants: { create: { sku: `current-${marker}`, name: "Current variant" } },
    },
    include: { variants: true },
  });
  product = p.id;
  variant = p.variants[0].id;
  paid = (
    await prisma.order.create({
      data: {
        number: `paid-${marker}`,
        customerId: customer,
        status: "PAID",
        currency: "USD",
        subtotalCents: 1000,
        taxCents: 80,
        totalCents: 1080,
        createdAt: new Date("2026-03-08T06:00:00Z"),
        items: {
          create: {
            productVariantId: variant,
            nameSnapshot: "Historical detergent",
            skuSnapshot: `sold-${marker}`,
            quantity: 1,
            unitPriceCents: 1000,
            taxCents: 80,
            lineTotalCents: 1080,
          },
        },
        payments: {
          create: {
            provider: "STRIPE",
            status: "CAPTURED",
            amountCents: 1080,
            externalId: `pi_${marker}`,
            events: {
              create: {
                type: "checkout.session.completed",
                verifiedAt: new Date(),
                payload: { privateProviderPayload: "must-not-leak" },
              },
            },
          },
        },
        taxCalculation: {
          create: {
            provider: "STRIPE",
            destinationJson: { privateDestination: "must-not-leak" },
            taxableCents: 1000,
            taxCents: 80,
          },
        },
      },
    })
  ).id;
  pending = (
    await prisma.order.create({
      data: {
        number: `pending-${marker}`,
        customerId: customer,
        status: "PENDING_PAYMENT",
        currency: "CAD",
        totalCents: 1234,
        createdAt: new Date("2026-03-09T05:00:00Z"),
        checkoutAttempt: {
          create: {
            customerId: customer,
            requestKey: marker,
            requestHash: marker,
            state: "REVIEW",
            snapshot: { privateQuote: "must-not-leak" },
            expiresAt: new Date(),
            stripeAccountId: "acct_synthetic",
            livemode: false,
            stripeSessionId: `cs_${marker}`,
          },
        },
      },
    })
  ).id;
});
afterAll(async () => {
  if (!customer) return;
  const payments = await prisma.payment.findMany({
    where: { order: { customerId: customer } },
    select: { id: true },
  });
  await prisma.paymentEvent.deleteMany({
    where: { paymentId: { in: payments.map((p) => p.id) } },
  });
  await prisma.payment.deleteMany({ where: { order: { customerId: customer } } });
  await prisma.taxCalculation.deleteMany({ where: { order: { customerId: customer } } });
  await prisma.orderItem.deleteMany({ where: { order: { customerId: customer } } });
  await prisma.checkoutAttempt.deleteMany({ where: { customerId: customer } });
  await prisma.order.deleteMany({ where: { customerId: customer } });
  await prisma.productVariant.delete({ where: { id: variant } });
  await prisma.product.delete({ where: { id: product } });
  await prisma.customer.delete({ where: { id: customer } });
  await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});
describe("native staff order workspace", () => {
  it("filters dates in Chicago time across daylight saving and counts all matched statuses", async () => {
    const day = await listOrders(admin, {
      q: marker,
      from: "2026-03-08",
      to: "2026-03-08",
    });
    expect(day.rows.map((r) => r.id)).toEqual([paid]);
    const filtered = await listOrders(admin, { q: marker, status: "PAID" });
    expect(filtered.count).toBe(1);
    expect(filtered.statusCounts).toMatchObject({ PAID: 1, PENDING_PAYMENT: 1 });
    expect(filtered.reviewCount).toBe(1);
    expect(
      (await listOrders(admin, { q: marker, view: "review" })).rows.map((r) => r.id),
    ).toEqual([pending]);
    expect(
      (await listOrders(admin, { q: `sold-${marker}` })).rows.map((r) => r.id),
    ).toEqual([paid]);
  });
  it("reads saved item, payment and tax evidence without exposing raw provider or quote payloads", async () => {
    const before = await prisma.order.findUniqueOrThrow({
      where: { id: paid },
      include: {
        items: true,
        payments: { include: { events: true } },
        taxCalculation: true,
      },
    });
    await prisma.product.update({
      where: { id: product },
      data: { name: "Renamed current catalog" },
    });
    const detail = await getOrder(cpa, paid);
    expect(detail.items[0].nameSnapshot).toBe("Historical detergent");
    expect(detail.amounts.totalCents).toBe(1080);
    expect(detail.payments[0].verified).toBe(true);
    expect(detail.cogsCents).toBeNull();
    expect(detail.canManage).toBe(false);
    expect(JSON.stringify(detail)).not.toContain("must-not-leak");
    const checkout = await getOrder(cpa, pending);
    expect(checkout.checkout?.canReconcile).toBe(false);
    expect((await getOrder(admin, pending)).checkout?.canReconcile).toBe(true);
    expect(JSON.stringify(checkout)).not.toContain("must-not-leak");
    expect(JSON.stringify(checkout)).not.toContain(`cs_${marker}`);
    expect(
      await prisma.order.findUniqueOrThrow({
        where: { id: paid },
        include: {
          items: true,
          payments: { include: { events: true } },
          taxCalculation: true,
        },
      }),
    ).toEqual(before);
  });
  it("returns complete count with bounded pages", async () => {
    await prisma.order.createMany({
      data: Array.from({ length: 51 }, (_, i) => ({
        customerId: customer,
        number: `pages-${marker}-${i}`,
      })),
    });
    const page = await listOrders(cpa, { q: `pages-${marker}`, page: 2 });
    expect(page.count).toBe(51);
    expect(page.rows).toHaveLength(1);
  });
  it("rechecks current roles and account state before exposing order details", async () => {
    for (const user of [employee, users[3]]) {
      await expect(listOrders(user, {})).rejects.toMatchObject({ status: 403 });
      await expect(getOrder(user, paid)).rejects.toMatchObject({ status: 403 });
    }
    await expect(getOrder(cpa, "not-an-order")).rejects.toMatchObject({ status: 404 });
    await prisma.user.update({
      where: { id: admin },
      data: { mustChangeCredentials: true },
    });
    try {
      await expect(getOrder(admin, paid)).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.user.update({
        where: { id: admin },
        data: { mustChangeCredentials: false },
      });
    }
    await prisma.userRole.deleteMany({ where: { userId: cpa } });
    await expect(getOrder(cpa, paid)).rejects.toMatchObject({ status: 403 });
  });
});
