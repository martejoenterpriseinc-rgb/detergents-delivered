import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { LAUNCH_KEY, defaultLaunch } from "@/lib/domain/launch";
import { businessDate } from "@/lib/domain/operations";
import { createQuote, json } from "./quote";
import { reserveCheckout } from "./reservations";
import { ownedCheckout, settleVerifiedSession } from "./checkout";
import { saveVehicleCapacity } from "@/lib/services/launch";
import { saveDeliveryAddress, approveDeliveryAddress } from "./onboarding";
vi.mock("./stripe", async (importOriginal) => {
  const original = await importOriginal<typeof import("./stripe")>();
  return {
    ...original,
    calculateCheckoutTax: vi.fn(async (s) => ({
      taxCents: Math.round(s.totalCents * 0.08),
      totalCents: s.totalCents + Math.round(s.totalCents * 0.08),
      taxCalculationId: `taxcalc_mock_${randomUUID()}`,
      taxBreakdown: [
        { source: "MOCKED_PROVIDER", amount: Math.round(s.totalCents * 0.08) },
      ],
    })),
  };
});
let prior: unknown;
let f: Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const id = randomUUID();
  const role = await prisma.role.upsert({
    where: { code: "CUSTOMER" },
    update: {},
    create: { code: "CUSTOMER", name: "Customer" },
  });
  const adminRole = await prisma.role.upsert({
    where: { code: "ADMIN" },
    update: {},
    create: { code: "ADMIN", name: "Admin" },
  });
  const admin = await prisma.user.create({
    data: {
      email: `checkout-admin-${id}@example.test`,
      userRoles: { create: { roleId: adminRole.id } },
    },
  });
  const zone = await prisma.deliveryZone.create({
    data: {
      name: "Checkout test area",
      slug: id,
      boundaryJson: { postalCodes: ["60099"] },
    },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      name: id,
      capacityStops: 10,
      capacityUnits: 100,
      detergentBucketLimit: 10,
      scentBeadBucketLimit: 10,
    },
  });
  const customer = async (suffix: string) =>
    prisma.user.create({
      data: {
        email: `${suffix}-${id}@example.test`,
        emailVerified: new Date(),
        userRoles: { create: { roleId: role.id } },
        customer: {
          create: {
            firstName: "Synthetic",
            lastName: suffix,
            purchaseApprovedAt: new Date(),
            addresses: {
              create: {
                line1: "100 Synthetic Lane",
                city: "Test City",
                region: "IL",
                postalCode: "60099",
                country: "US",
                deliveryZoneId: zone.id,
                validatedAt: new Date(),
                validationSource: "SYNTHETIC_FIXTURE",
                lat: 42.2,
                lng: -88.2,
              },
            },
          },
        },
      },
      include: { customer: { include: { addresses: true } } },
    });
  const one = await customer("one"),
    two = await customer("two");
  const product = await prisma.product.create({
    data: {
      slug: `checkout-${id}`,
      name: "Synthetic detergent",
      brand: "Test",
      websiteVisible: true,
      loadKind: "DETERGENT",
      taxCategory: "txcd_99999999",
      variants: {
        create: {
          name: "Bucket",
          sku: id,
          prices: { create: { kind: "SALE", amountCents: 3500, startsAt: new Date(0) } },
          inventoryBalance: { create: { onHandQty: 10 } },
          costLayers: {
            create: {
              quantityOriginal: 10,
              quantityRemaining: 10,
              landedUnitCostCents: 1600,
              receivedAt: new Date(),
            },
          },
        },
      },
    },
    include: { variants: true },
  });
  const today = businessDate();
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 20);
  await prisma.setting.upsert({
    where: { key: LAUNCH_KEY },
    update: {
      valueJson: {
        ...defaultLaunch,
        version: 1,
        enabled: true,
        launchDate: today,
        cutoffDate: today,
        firstDeliveryBy: end.toISOString().slice(0, 10),
        cadences: [
          {
            zoneId: zone.id,
            vehicleId: vehicle.id,
            weeks: [1, 2, 3, 4, 5, 6],
            weekday: new Date(today).getUTCDay(),
            locked: true,
          },
        ],
      },
    },
    create: { key: LAUNCH_KEY, valueJson: { ...defaultLaunch } },
  });
  return { admin, zone, vehicle, one, two, product, variant: product.variants[0] };
}
beforeEach(async () => {
  vi.stubEnv("DD_CHECKOUT_ENABLED", "true");
  vi.stubEnv("DD_STRIPE_ACCOUNT_ID", "acct_synthetic");
  vi.stubEnv("STRIPE_RESTRICTED_KEY", "rk_test_synthetic_fixture");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_synthetic_fixture");
  prior =
    (await prisma.setting.findUnique({ where: { key: LAUNCH_KEY } }))?.valueJson ??
    defaultLaunch;
  await prisma.setting.upsert({
    where: { key: LAUNCH_KEY },
    update: {},
    create: { key: LAUNCH_KEY, valueJson: json(prior) },
  });
  f = await fixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (f) {
    await prisma.route.updateMany({
      where: { vehicleId: f.vehicle.id },
      data: { status: "CANCELLED" },
    });
    await prisma.deliveryZone.update({
      where: { id: f.zone.id },
      data: { isActive: false },
    });
    await prisma.vehicle.update({
      where: { id: f.vehicle.id },
      data: { isActive: false },
    });
    await prisma.user.updateMany({
      where: { id: { in: [f.admin.id, f.one.id, f.two.id] } },
      data: { deletedAt: new Date() },
    });
  }
  await prisma.setting.upsert({
    where: { key: LAUNCH_KEY },
    update: { valueJson: json(prior) },
    create: { key: LAUNCH_KEY, valueJson: json(prior) },
  });
});
const input = (user = f.one, useRewards = false) => ({
  requestKey: randomUUID(),
  addressId: user.customer!.addresses[0].id,
  lines: [{ variantId: f.variant.id, quantity: 1 }],
  useRewards,
});
async function quoteAndHold(user = f.one, useRewards = false) {
  const q = await createQuote(user.id, input(user, useRewards));
  await reserveCheckout(user.id, q.id, true);
  return q;
}
function session(q: Awaited<ReturnType<typeof createQuote>>, status = "paid") {
  return {
    id: `cs_test_${q.id}`,
    client_reference_id: q.id,
    metadata: { checkoutId: q.id, project: "detergents-delivered" },
    livemode: false,
    mode: "payment",
    currency: "usd",
    status: status === "expired" ? "expired" : "complete",
    payment_status: status === "expired" ? "unpaid" : status,
    amount_total: q.totalCents,
    payment_intent: q.totalCents ? `pi_${q.id}` : null,
    total_details: { amount_tax: q.taxCents },
    automatic_tax: { status: "complete" },
  } as unknown as Stripe.Checkout.Session;
}
const evidence = () => ({
  id: `evt_mock_${randomUUID()}`,
  type: "checkout.session.completed",
  source: "webhook" as const,
});
const taxLines = (q: Awaited<ReturnType<typeof createQuote>>) =>
  q.lines.map((l) => ({
    variantId: l.variantId,
    netCents: l.netCents,
    taxCents: q.taxCents,
  }));
it("rejects foreign addresses and does not reveal another customer's checkout", async () => {
  await expect(createQuote(f.two.id, input())).rejects.toMatchObject({ status: 409 });
  const q = await createQuote(f.one.id, input());
  await expect(ownedCheckout(f.two.id, q.id)).rejects.toMatchObject({ status: 404 });
});
it("serializes two buyers competing for the last item", async () => {
  await prisma.inventoryBalance.update({
    where: { productVariantId: f.variant.id },
    data: { onHandQty: 1 },
  });
  const a = await createQuote(f.one.id, input()),
    b = await createQuote(f.two.id, input(f.two));
  const results = await Promise.allSettled([
    reserveCheckout(f.one.id, a.id, true),
    reserveCheckout(f.two.id, b.id, true),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (
      await prisma.inventoryBalance.findUniqueOrThrow({
        where: { productVariantId: f.variant.id },
      })
    ).reservedQty,
  ).toBe(1);
});
it("reserves mixed-load capacity across buyers and blocks unsafe capacity reductions", async () => {
  await prisma.vehicle.update({
    where: { id: f.vehicle.id },
    data: { capacityUnits: 1, detergentBucketLimit: 1 },
  });
  const setting = await prisma.setting.findUniqueOrThrow({ where: { key: LAUNCH_KEY } });
  await prisma.setting.update({
    where: { id: setting.id },
    data: {
      valueJson: { ...(setting.valueJson as object), firstDeliveryBy: businessDate() },
    },
  });
  const a = await createQuote(f.one.id, input()),
    b = await createQuote(f.two.id, input(f.two));
  await reserveCheckout(f.one.id, a.id, true);
  await expect(reserveCheckout(f.two.id, b.id, true)).rejects.toMatchObject({
    status: 409,
  });
  const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: f.vehicle.id } });
  await expect(
    saveVehicleCapacity(f.admin.id, {
      id: vehicle.id,
      updatedAt: vehicle.updatedAt.toISOString(),
      capacityStops: 1,
      capacityUnits: 1,
      detergentBucketLimit: 0,
      scentBeadBucketLimit: 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("replays the same reservation once and rejects stale prices or missing consent", async () => {
  const q = await createQuote(f.one.id, input());
  await expect(reserveCheckout(f.one.id, q.id, false)).rejects.toMatchObject({
    status: 400,
  });
  await prisma.productPrice.create({
    data: {
      productVariantId: f.variant.id,
      kind: "SALE",
      amountCents: 3600,
      startsAt: new Date(),
    },
  });
  await expect(reserveCheckout(f.one.id, q.id, true)).rejects.toMatchObject({
    status: 409,
  });
  const next = await createQuote(f.one.id, input());
  await Promise.all([
    reserveCheckout(f.one.id, next.id, true),
    reserveCheckout(f.one.id, next.id, true),
  ]);
  expect(
    await prisma.inventoryTransaction.count({
      where: { referenceId: next.id, type: "CUSTOMER_RESERVATION" },
    }),
  ).toBe(1);
});
it("atomically finalizes payment, inventory, exact FIFO costs, route and duplicate webhook", async () => {
  const q = await quoteAndHold();
  const e = evidence();
  await Promise.all([
    settleVerifiedSession(session(q), e, taxLines(q)),
    settleVerifiedSession(session(q), e, taxLines(q)),
  ]);
  const a = await ownedCheckout(f.one.id, q.id);
  expect(a.state).toBe("PAID");
  expect(await prisma.payment.count({ where: { orderId: a.orderId! } })).toBe(1);
  expect(await prisma.routeStop.count({ where: { orderId: a.orderId! } })).toBe(1);
  expect(
    await prisma.inventoryBalance.findUnique({
      where: { productVariantId: f.variant.id },
    }),
  ).toMatchObject({ onHandQty: 9, reservedQty: 0 });
  expect(
    await prisma.checkoutCostAllocation.findFirst({ where: { checkoutId: q.id } }),
  ).toMatchObject({ state: "CONSUMED", unitCostCents: 1600 });
  expect(
    await prisma.orderItem.findFirst({ where: { orderId: a.orderId! } }),
  ).toMatchObject({ landedUnitCostCents: 1600, taxCents: 280, lineTotalCents: 3780 });
});
it("caps reward use and completes a zero-payment session without inventing cash", async () => {
  await prisma.rewardEntry.create({
    data: {
      customerId: f.one.customer!.id,
      kind: "REFERRAL",
      amountCents: 5000,
      entryKey: randomUUID(),
      sourceId: "SYNTHETIC",
      description: "Synthetic credit",
    },
  });
  const q = await quoteAndHold(f.one, true);
  expect(q).toMatchObject({ totalCents: 0, rewardsCents: 3500 });
  await settleVerifiedSession(session(q, "no_payment_required"), evidence(), taxLines(q));
  expect(
    (
      await prisma.rewardEntry.aggregate({
        where: { customerId: f.one.customer!.id },
        _sum: { amountCents: true },
      })
    )._sum.amountCents,
  ).toBe(1500);
  const a = await ownedCheckout(f.one.id, q.id);
  expect(
    await prisma.payment.findFirst({ where: { orderId: a.orderId! } }),
  ).toMatchObject({ amountCents: 0 });
});
it("retains all holds when payment totals differ, or while an asynchronous payment is pending", async () => {
  const q = await quoteAndHold();
  await settleVerifiedSession(
    { ...session(q), amount_total: 1 },
    evidence(),
    taxLines(q),
  );
  expect((await ownedCheckout(f.one.id, q.id)).state).toBe("REVIEW");
  expect(
    (
      await prisma.inventoryBalance.findUniqueOrThrow({
        where: { productVariantId: f.variant.id },
      })
    ).reservedQty,
  ).toBe(1);
});
it("releases only a provider-confirmed expired checkout and replays release safely", async () => {
  const q = await quoteAndHold();
  await settleVerifiedSession(session(q, "unpaid"), evidence(), []);
  expect((await ownedCheckout(f.one.id, q.id)).state).toBe("PROCESSING");
  await settleVerifiedSession(session(q, "expired"), evidence(), []);
  await settleVerifiedSession(session(q, "expired"), evidence(), []);
  expect((await ownedCheckout(f.one.id, q.id)).state).toBe("EXPIRED");
  expect(
    await prisma.inventoryBalance.findUnique({
      where: { productVariantId: f.variant.id },
    }),
  ).toMatchObject({ onHandQty: 10, reservedQty: 0 });
});
it("rolls back finalization when its audit record cannot persist", async () => {
  const q = await quoteAndHold();
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT dd_checkout_audit_failure CHECK ("entityId" IS DISTINCT FROM '${(await ownedCheckout(f.one.id, q.id)).orderId!}') NOT VALID`,
  );
  try {
    await expect(
      settleVerifiedSession(session(q), evidence(), taxLines(q)),
    ).rejects.toThrow();
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT dd_checkout_audit_failure',
    );
  }
  expect((await ownedCheckout(f.one.id, q.id)).state).toBe("PREPARING");
  expect(
    (
      await prisma.inventoryBalance.findUniqueOrThrow({
        where: { productVariantId: f.variant.id },
      })
    ).reservedQty,
  ).toBe(1);
  expect(
    await prisma.payment.count({
      where: { orderId: (await ownedCheckout(f.one.id, q.id)).orderId! },
    }),
  ).toBe(0);
});
it("retains a delayed paid checkout for review if its reserved route has started", async () => {
  const q = await quoteAndHold();
  const a = await ownedCheckout(f.one.id, q.id);
  await prisma.route.create({
    data: {
      number: `synthetic-started-${randomUUID()}`,
      vehicleId: a.vehicleId!,
      deliveryZoneId: a.zoneId!,
      serviceDate: new Date(a.serviceDate!),
      status: "IN_PROGRESS",
    },
  });
  await settleVerifiedSession(session(q), evidence(), taxLines(q));
  expect((await ownedCheckout(f.one.id, q.id)).state).toBe("REVIEW");
  expect(await prisma.routeStop.count({ where: { orderId: a.orderId! } })).toBe(0);
  expect(
    await prisma.inventoryBalance.findUnique({
      where: { productVariantId: f.variant.id },
    }),
  ).toMatchObject({ onHandQty: 10, reservedQty: 1 });
});
it("requires real staff authorization and preserves address changes as new unapproved rows", async () => {
  const saved = await saveDeliveryAddress(f.one.id, {
    line1: "200 Synthetic Road",
    line2: "",
    city: "Test City",
    region: "IL",
    postalCode: "60099",
  });
  const a = await prisma.address.findUniqueOrThrow({ where: { id: saved.id } });
  const review = {
    addressId: a.id,
    version: a.updatedAt.toISOString(),
    lat: 42.2,
    lng: -88.2,
    evidence: "Synthetic manual fixture review",
    confirmReviewed: true,
  };
  await expect(approveDeliveryAddress(f.two.id, review)).rejects.toMatchObject({
    status: 403,
  });
  await approveDeliveryAddress(f.admin.id, review);
  expect(await prisma.address.findUnique({ where: { id: a.id } })).toMatchObject({
    validationSource: "STAFF_REVIEW",
  });
});
