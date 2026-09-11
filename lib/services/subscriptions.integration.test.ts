import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createSubscription,
  changeSubscription,
  readSubscriptions,
} from "./subscriptions";
import { subscriptionConsentVersion, quarterDate } from "@/lib/domain/subscriptions";
import { businessDate } from "@/lib/domain/operations";
const users: string[] = [];
async function fixture() {
  const marker = randomUUID();
  const role = await prisma.role.upsert({
    where: { code: "CUSTOMER" },
    update: {},
    create: { code: "CUSTOMER", name: "Customer" },
  });
  const user = await prisma.user.create({
    data: {
      email: `subscription-${marker}@example.test`,
      emailVerified: new Date(),
      userRoles: { create: { roleId: role.id } },
      customer: { create: { purchaseApprovedAt: new Date() } },
    },
    include: { customer: true },
  });
  users.push(user.id);
  const customer = user.customer!;
  const address = await prisma.address.create({
    data: {
      customerId: customer.id,
      line1: "1 Synthetic Way",
      city: "Algonquin",
      region: "IL",
      postalCode: "60102",
      country: "US",
    },
  });
  const product = await prisma.product.create({
    data: {
      name: "Synthetic subscription",
      slug: marker,
      brand: "Synthetic",
      variants: { create: { name: "Bucket", sku: marker } },
    },
    include: { variants: true },
  });
  const order = await prisma.order.create({
    data: {
      number: marker,
      customerId: customer.id,
      addressId: address.id,
      status: "DELIVERED",
      subtotalCents: 1000,
      taxCents: 80,
      totalCents: 1080,
      items: {
        create: {
          productVariantId: product.variants[0].id,
          nameSnapshot: "Original item",
          skuSnapshot: marker,
          quantity: 1,
          unitPriceCents: 1000,
          taxCents: 80,
          lineTotalCents: 1080,
        },
      },
      checkoutAttempt: {
        create: {
          customerId: customer.id,
          requestKey: marker,
          requestHash: marker,
          state: "PAID",
          snapshot: {},
          expiresAt: new Date(),
          stripeAccountId: "acct_synthetic",
          livemode: false,
        },
      },
    },
    include: { checkoutAttempt: true },
  });
  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "STRIPE",
      status: "CAPTURED",
      amountCents: 1080,
      externalId: `pi_${marker.replaceAll("-", "")}`,
      events: {
        create: {
          type: "checkout.session.completed",
          externalId: `checkout:${order.checkoutAttempt!.id}:paid`,
          verifiedAt: new Date(),
        },
      },
    },
  });
  const input = {
    requestKey: randomUUID(),
    originOrderId: order.id,
    accepted: true as const,
    consentVersion: subscriptionConsentVersion,
  };
  return { user, customer, order, input };
}
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: users } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
describe("quarterly subscription controls (isolated PostgreSQL)", () => {
  it("requires consent and records one subscription and immutable consent event on retry", async () => {
    const f = await fixture();
    await expect(
      createSubscription(f.user.id, { ...f.input, accepted: false }),
    ).rejects.toThrow();
    const [a, b] = await Promise.all([
      createSubscription(f.user.id, f.input),
      createSubscription(f.user.id, f.input),
    ]);
    expect(a).toEqual(b);
    expect(a.nextDate).toBe(quarterDate(businessDate(), 1));
    expect(
      await prisma.subscriptionEvent.count({ where: { subscriptionId: a.id } }),
    ).toBe(1);
    await expect(
      createSubscription(f.user.id, { ...f.input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    const event = await prisma.subscriptionEvent.findFirstOrThrow({
      where: { subscriptionId: a.id },
    });
    await expect(
      prisma.subscriptionEvent.update({
        where: { id: event.id },
        data: { action: "edited" },
      }),
    ).rejects.toThrow();
    expect(
      (await prisma.subscription.findUniqueOrThrow({ where: { id: a.id } })).cadenceDays,
    ).toBeNull();
  });
  it("supports pause, resume, skip and cancellation with version conflicts and no financial side effects", async () => {
    const f = await fixture();
    let s = await createSubscription(f.user.id, f.input);
    const change = (action: "pause" | "resume" | "skip" | "cancel") =>
      changeSubscription(f.user.id, {
        requestKey: randomUUID(),
        id: s.id,
        version: s.version,
        action,
      });
    const old = s;
    s = await change("pause");
    expect(s.status).toBe("PAUSED");
    await expect(
      changeSubscription(f.user.id, {
        requestKey: randomUUID(),
        id: s.id,
        version: old.version,
        action: "cancel",
      }),
    ).rejects.toMatchObject({ status: 409 });
    s = await change("resume");
    expect(s.status).toBe("ACTIVE");
    s = await change("skip");
    expect(s.nextDate).toBe(quarterDate(businessDate(), 2));
    s = await change("cancel");
    expect(s.status).toBe("CANCELLED");
    expect(s.nextDate).toBeNull();
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1);
    expect(await prisma.payment.count({ where: { orderId: f.order.id } })).toBe(1);
    expect(await prisma.rewardEntry.count({ where: { customerId: f.customer.id } })).toBe(
      0,
    );
  });
  it("isolates households, rejects revoked eligibility and keeps older schedules unconverted", async () => {
    const a = await fixture(),
      b = await fixture();
    const s = await createSubscription(a.user.id, a.input);
    await expect(
      changeSubscription(b.user.id, {
        requestKey: randomUUID(),
        id: s.id,
        version: 0,
        action: "cancel",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await readSubscriptions(b.user.id)).subscriptions).toHaveLength(0);
    await prisma.user.update({ where: { id: b.user.id }, data: { emailVerified: null } });
    await expect(createSubscription(b.user.id, b.input)).rejects.toMatchObject({
      status: 403,
    });
    const legacy = await prisma.subscription.create({
      data: { customerId: b.customer.id, cadenceDays: 28, status: "PAUSED" },
    });
    await expect(
      changeSubscription(b.user.id, {
        requestKey: randomUUID(),
        id: legacy.id,
        version: 0,
        action: "resume",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await changeSubscription(b.user.id, {
          requestKey: randomUUID(),
          id: legacy.id,
          version: 0,
          action: "cancel",
        })
      ).status,
    ).toBe("CANCELLED");
  });
  it("rolls subscription and consent back when the audit cannot be written", async () => {
    const f = await fixture();
    await prisma.$executeRawUnsafe(
      "ALTER TABLE \"AuditLog\" ADD CONSTRAINT dd_subscription_audit CHECK (action <> 'subscription.created') NOT VALID",
    );
    try {
      await expect(createSubscription(f.user.id, f.input)).rejects.toThrow();
      expect(
        await prisma.subscription.count({ where: { customerId: f.customer.id } }),
      ).toBe(0);
      expect(
        await prisma.subscriptionEvent.count({ where: { actorUserId: f.user.id } }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" DROP CONSTRAINT dd_subscription_audit',
      );
    }
    await createSubscription(f.user.id, f.input);
  });
});
