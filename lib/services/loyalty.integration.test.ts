import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getLoyalty,
  loyaltyAction,
  programConfig,
  quoteCartRewards,
  rewardBalance,
  updateProgram,
} from "./loyalty";
import {
  commitOrderRewards,
  releaseOrderRewards,
  reserveOrderRewards,
  reviewReferral,
} from "./reward-ledger";
import { getDeliveryWidget } from "./delivery-widget";
const ids: string[] = [];
async function user(admin = false, verified = true) {
  const role = await prisma.role.upsert({
    where: { code: admin ? "ADMIN" : "CUSTOMER" },
    update: {},
    create: { code: admin ? "ADMIN" : "CUSTOMER", name: "Synthetic" },
  });
  const row = await prisma.user.create({
    data: {
      email: `loyalty-${randomUUID()}@example.test`,
      emailVerified: verified ? new Date() : null,
      userRoles: { create: { roleId: role.id } },
      customer: {
        create: {
          firstName: "Synthetic",
          addresses: {
            create: {
              line1: randomUUID(),
              city: "Algonquin",
              region: "IL",
              postalCode: "60102",
            },
          },
        },
      },
    },
    include: { customer: true },
  });
  ids.push(row.id);
  return row;
}
async function setup() {
  const admin = await user(true);
  const a = await user();
  const b = await user();
  const p = await programConfig();
  await updateProgram(admin.id, {
    enabled: true,
    referrerRewardCents: 5000,
    friendRewardCents: 500,
    minimumPurchaseCents: 3500,
    linkExpiryDays: 30,
    maxReferralsPerCustomer: 25,
    version: p.version,
  });
  const created = await loyaltyAction(a.id, {
    action: "create",
    label: "Test neighbor",
    requestKey: randomUUID(),
  });
  const link = await prisma.referralLink.findUniqueOrThrow({ where: { id: created.id } });
  const claimed = await loyaltyAction(b.id, { action: "claim", token: link.token });
  const referral = await prisma.referral.findUniqueOrThrow({ where: { id: claimed.id } });
  return { admin, a, b, link, referral };
}
async function paid(customerId: string, verified = true, totalCents = 3500) {
  const order = await prisma.order.create({
    data: {
      number: randomUUID(),
      customerId,
      status: "PAID",
      subtotalCents: totalCents,
      totalCents,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "STRIPE",
      status: "CAPTURED",
      amountCents: totalCents,
      externalId: `synthetic-pi-${randomUUID()}`,
      events: {
        create: {
          type: "payment_intent.succeeded",
          externalId: `synthetic-evt-${randomUUID()}`,
          verifiedAt: verified ? new Date() : null,
        },
      },
    },
  });
  return { order, payment };
}
async function award() {
  const s = await setup();
  const p = await paid(s.b.customer!.id);
  await reviewReferral(s.admin.id, s.referral.id);
  return { ...s, ...p };
}
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
describe("loyalty ledger and live delivery (native isolated PG; synthetic provider evidence)", () => {
  it("persists program settings with role checks and stale-write protection", async () => {
    const s = await setup();
    const p = await programConfig();
    const settings = {
      enabled: false,
      referrerRewardCents: 1000,
      friendRewardCents: 0,
      minimumPurchaseCents: 3000,
      linkExpiryDays: 10,
      maxReferralsPerCustomer: 10,
      version: p.version,
    };
    await expect(updateProgram(s.a.id, settings)).rejects.toMatchObject({ status: 403 });
    await updateProgram(s.admin.id, settings);
    await expect(updateProgram(s.admin.id, settings)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      (await prisma.referral.findUniqueOrThrow({ where: { id: s.referral.id } }))
        .creditCents,
    ).toBe(5000);
    await expect(
      loyaltyAction(s.a.id, {
        action: "create",
        label: "Paused",
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("keeps shared-ZIP customers isolated and prevents unverified, duplicate, expired and self claims", async () => {
    const s = await setup();
    const other = await user();
    const unverified = await user(false, false);
    await expect(
      loyaltyAction(unverified.id, {
        action: "create",
        label: "Invalid",
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      loyaltyAction(s.a.id, { action: "claim", token: s.link.token }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      loyaltyAction(other.id, { action: "claim", token: s.link.token }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      loyaltyAction(other.id, { action: "shared", id: s.link.id, method: "COPY" }),
    ).rejects.toMatchObject({ status: 404 });
    const key = randomUUID();
    const request = { action: "create", label: "Unique", requestKey: key };
    const [a, b] = await Promise.all([
      loyaltyAction(s.a.id, request),
      loyaltyAction(s.a.id, request),
    ]);
    expect(a.id).toBe(b.id);
    await expect(
      loyaltyAction(s.a.id, { ...request, label: "Changed" }),
    ).rejects.toMatchObject({ status: 409 });
    const expired = await prisma.referralLink.update({
      where: { id: a.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      loyaltyAction(other.id, { action: "claim", token: expired.token }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await getLoyalty(other.id)).links).toHaveLength(0);
  });
  it("requires verified paid first-purchase evidence and awards once under duplicate reviews", async () => {
    const s = await setup();
    const p = await paid(s.b.customer!.id, false);
    await expect(reviewReferral(s.admin.id, s.referral.id)).rejects.toThrow(
      /Verified payment/,
    );
    expect((await getLoyalty(s.a.id)).balance.availableCents).toBe(0);
    await prisma.paymentEvent.updateMany({
      where: { paymentId: p.payment.id },
      data: { verifiedAt: new Date() },
    });
    await Promise.all([
      reviewReferral(s.admin.id, s.referral.id),
      reviewReferral(s.admin.id, s.referral.id),
    ]);
    expect((await getLoyalty(s.a.id)).balance.availableCents).toBe(5000);
    expect((await getLoyalty(s.b.id)).balance.availableCents).toBe(500);
    expect(
      (await getLoyalty(s.a.id)).entries.every((entry) => entry.order === null),
    ).toBe(true);
    expect(JSON.stringify(await getLoyalty(s.a.id))).not.toContain(p.order.number);
    expect(await prisma.rewardEntry.count({ where: { sourceId: s.referral.id } })).toBe(
      2,
    );
    expect(await prisma.order.findUnique({ where: { id: p.order.id } })).toEqual(p.order);
  });
  it("caps competing holds, rejects missing payment, commits once and preserves order money", async () => {
    const s = await award();
    const orders = await Promise.all(
      [1, 2].map(() =>
        prisma.order.create({
          data: {
            number: randomUUID(),
            customerId: s.a.customer!.id,
            status: "PENDING_PAYMENT",
            totalCents: 3500,
          },
        }),
      ),
    );
    const keys = [randomUUID(), randomUUID()];
    const holds = await Promise.all(
      orders.map((o, i) =>
        prisma.$transaction((tx) => reserveOrderRewards(tx, s.a.id, o.id, keys[i])),
      ),
    );
    expect(holds.reduce((n, h) => n + h.amountCents, 0)).toBe(5000);
    expect((await getLoyalty(s.a.id)).balance.availableCents).toBe(0);
    const full = holds.find((h) => h.amountCents === 3500)!;
    const partial = holds.find((h) => h.amountCents === 1500)!;
    await expect(
      prisma.$transaction((tx) => commitOrderRewards(tx, partial.orderId)),
    ).rejects.toThrow(/Confirmed payment/);
    await expect(
      prisma.$transaction((tx) =>
        reserveOrderRewards(tx, s.b.id, full.orderId, randomUUID()),
      ),
    ).rejects.toMatchObject({ status: 404 });
    const results = await Promise.all(
      [1, 2].map(() => prisma.$transaction((tx) => commitOrderRewards(tx, full.orderId))),
    );
    expect(results[0]).toMatchObject({
      usedCents: 3500,
      remainingCents: 0,
      confirmed: true,
    });
    expect(
      await prisma.rewardEntry.count({
        where: { orderId: full.orderId, kind: "REDEMPTION" },
      }),
    ).toBe(1);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: full.orderId } })).totalCents,
    ).toBe(3500);
    await prisma.payment.create({
      data: {
        orderId: partial.orderId,
        status: "CAPTURED",
        amountCents: 2000,
        externalId: `synthetic-${randomUUID()}`,
        events: {
          create: {
            type: "payment_intent.succeeded",
            externalId: randomUUID(),
            verifiedAt: new Date(),
          },
        },
      },
    });
    await prisma.$transaction((tx) => commitOrderRewards(tx, partial.orderId));
    expect((await getLoyalty(s.a.id)).balance).toMatchObject({
      balanceCents: 0,
      heldCents: 0,
      availableCents: 0,
    });
  });
  it("retains unused credits and releases interrupted checkout only after cancellation is reconciled", async () => {
    const s = await award();
    const o = await prisma.order.create({
      data: {
        number: randomUUID(),
        customerId: s.a.customer!.id,
        status: "PENDING_PAYMENT",
        totalCents: 1200,
      },
    });
    const key = randomUUID();
    const hold = await prisma.$transaction((tx) =>
      reserveOrderRewards(tx, s.a.id, o.id, key),
    );
    expect(hold.amountCents).toBe(1200);
    expect((await getLoyalty(s.a.id)).balance.availableCents).toBe(3800);
    expect(
      (await prisma.$transaction((tx) => reserveOrderRewards(tx, s.a.id, o.id, key))).id,
    ).toBe(hold.id);
    await expect(
      prisma.$transaction((tx) => releaseOrderRewards(tx, o.id)),
    ).rejects.toThrow(/Cancel/);
    await prisma.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    await prisma.$transaction((tx) => releaseOrderRewards(tx, o.id));
    await prisma.$transaction((tx) => releaseOrderRewards(tx, o.id));
    expect((await getLoyalty(s.a.id)).balance.availableCents).toBe(5000);
    await expect(
      prisma.$transaction((tx) => commitOrderRewards(tx, o.id)),
    ).rejects.toThrow(/no longer matches/);
  });
  it("preserves ledger history and reverses refunded referral credits without double reversal", async () => {
    const s = await award();
    const o = await prisma.order.create({
      data: {
        number: randomUUID(),
        customerId: s.a.customer!.id,
        status: "PENDING_PAYMENT",
        totalCents: 3500,
      },
    });
    await prisma.$transaction((tx) =>
      reserveOrderRewards(tx, s.a.id, o.id, randomUUID()),
    );
    const used = await prisma.$transaction((tx) => commitOrderRewards(tx, o.id));
    expect(used).toMatchObject({ usedCents: 3500, remainingCents: 1500 });
    await prisma.order.update({
      where: { id: s.order.id },
      data: { status: "REFUNDED" },
    });
    await Promise.all([
      reviewReferral(s.admin.id, s.referral.id),
      reviewReferral(s.admin.id, s.referral.id),
    ]);
    expect((await getLoyalty(s.a.id)).balance).toMatchObject({
      balanceCents: -3500,
      availableCents: 0,
    });
    expect(
      await prisma.rewardEntry.count({
        where: { sourceId: s.referral.id, kind: "REVERSAL" },
      }),
    ).toBe(2);
    const entry = await prisma.rewardEntry.findFirstOrThrow({
      where: { customerId: s.a.customer!.id },
    });
    await expect(
      prisma.rewardEntry.update({ where: { id: entry.id }, data: { amountCents: 1 } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.rewardEntry.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );
  });
  it("rolls back an award on audit failure and quotes the authoritative catalog without spending", async () => {
    const s = await setup();
    await paid(s.b.customer!.id);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AuditLog" ADD CONSTRAINT dd_loyalty_fault CHECK ("actorUserId" IS DISTINCT FROM '${s.admin.id}') NOT VALID`,
    );
    try {
      await expect(reviewReferral(s.admin.id, s.referral.id)).rejects.toThrow();
      expect((await getLoyalty(s.a.id)).balance.availableCents).toBe(0);
      expect(
        (await prisma.referral.findUniqueOrThrow({ where: { id: s.referral.id } }))
          .status,
      ).toBe("PENDING");
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" DROP CONSTRAINT dd_loyalty_fault',
      );
    }
    await reviewReferral(s.admin.id, s.referral.id);
    const product = await prisma.product.create({
      data: {
        name: "Synthetic detergent",
        slug: randomUUID(),
        brand: "Synthetic",
        websiteVisible: true,
        variants: {
          create: {
            sku: randomUUID(),
            name: "Bucket",
            websiteVisible: true,
            prices: { create: { startsAt: new Date(0), amountCents: 1200 } },
          },
        },
      },
      include: { variants: true },
    });
    const quote = await quoteCartRewards(s.a.id, {
      lines: [{ variantId: product.variants[0].id, quantity: 1 }],
    });
    expect(quote).toMatchObject({
      appliedCents: 1200,
      remainingCents: 3800,
      previewOnly: true,
    });
    expect((await getLoyalty(s.a.id)).balance.availableCents).toBe(5000);
    expect(
      await prisma.rewardReservation.count({ where: { customerId: s.a.customer!.id } }),
    ).toBe(0);
    await prisma.product.update({
      where: { id: product.id },
      data: { websiteVisible: false },
    });
    await expect(
      quoteCartRewards(s.a.id, {
        lines: [{ variantId: product.variants[0].id, quantity: 1 }],
      }),
    ).rejects.toThrow(/unavailable/);
    expect(await rewardBalance(prisma, s.a.customer!.id)).toMatchObject({
      availableCents: 5000,
    });
  });
  it("reads actual customer delivery transitions without sharing another customer's status", async () => {
    const a = await user();
    const b = await user();
    const o = await prisma.order.create({
      data: {
        number: randomUUID(),
        customerId: a.customer!.id,
        status: "OUT_FOR_DELIVERY",
      },
    });
    expect(await getDeliveryWidget(a.id)).toMatchObject({
      status: "OUT_FOR_DELIVERY",
      orderNumber: o.number,
    });
    expect(await getDeliveryWidget(b.id)).toMatchObject({
      status: "NONE",
      orderNumber: null,
    });
    await prisma.order.update({ where: { id: o.id }, data: { status: "DELIVERED" } });
    expect(await getDeliveryWidget(a.id)).toMatchObject({ status: "DELIVERED" });
  });
});
