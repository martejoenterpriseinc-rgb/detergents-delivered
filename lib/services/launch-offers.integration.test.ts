import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { operationsFixture } from "@/tests/operations-fixture";
import { addShopEntry } from "./shop-entry";
import {
  createLaunchResource,
  launchConfig,
  saveLaunch,
  saveVehicleCapacity,
  saveZoneZips,
  launchDemand,
} from "./launch";
import { savePromotion } from "./promotions";
import { quoteCartRewards } from "./loyalty";
import { purchaseEligibility } from "./purchase-eligibility";
import { LAUNCH_KEY, defaultLaunch } from "@/lib/domain/launch";
import { businessDate } from "@/lib/domain/operations";
let f: Awaited<ReturnType<typeof operationsFixture>>;
let prior: Awaited<ReturnType<typeof launchConfig>>;
const resources: { id: string; type: string }[] = [];
beforeAll(async () => {
  f = await operationsFixture(prisma);
  prior = await launchConfig();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  if (f) await f.cleanup();
  if (prior)
    await prisma.setting.upsert({
      where: { key: LAUNCH_KEY },
      update: { valueJson: prior },
      create: { key: LAUNCH_KEY, valueJson: prior },
    });
  for (const resource of resources) {
    if (resource.type === "zone")
      await prisma.deliveryZone.update({
        where: { id: resource.id },
        data: { isActive: false },
      });
    else
      await prisma.vehicle.update({
        where: { id: resource.id },
        data: { isActive: false },
      });
  }
  await prisma.$disconnect();
});
const productData = () => ({
  title: "Synthetic launch detergent",
  description: "Test-only catalog record",
  sku: `LAUNCH-${randomUUID()}`,
  priceCents: 3500,
  retailCents: 5000,
  loadKind: "DETERGENT",
  deliveryCapacityUnits: 2,
  publish: true,
  requestKey: randomUUID(),
});
it("atomically creates one product/variant/prices, never invents stock, and rejects unauthorized or failed image saves", async () => {
  const data = productData();
  await expect(addShopEntry(f.customers[0].id, data)).rejects.toMatchObject({
    status: 403,
  });
  const results = await Promise.all([
    addShopEntry(f.admin.id, data),
    addShopEntry(f.admin.id, data),
  ]);
  expect(results[0].id).toBe(results[1].id);
  const saved = await prisma.product.findUniqueOrThrow({
    where: { id: results[0].id },
    include: { variants: { include: { inventoryBalance: true, prices: true } } },
  });
  expect(saved.variants).toHaveLength(1);
  expect(saved.variants[0].inventoryBalance).toBeNull();
  expect(saved.variants[0].prices.map((p) => p.amountCents).sort()).toEqual([3500, 5000]);
  await expect(
    addShopEntry(f.admin.id, { ...data, priceCents: 4000 }),
  ).rejects.toMatchObject({ status: 409 });
  vi.stubEnv("DD_LOCAL_CATALOG_STORAGE", "true");
  const invalid = productData();
  await expect(
    addShopEntry(f.admin.id, invalid, Buffer.from("synthetic-invalid-image")),
  ).rejects.toMatchObject({ status: 415 });
  expect(await prisma.productVariant.count({ where: { sku: invalid.sku } })).toBe(0);
});
it("uses sale prices for percentage discounts and preserves excess rewards without mutating orders or ledger", async () => {
  const saved = await addShopEntry(f.admin.id, productData());
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: saved.id },
  });
  const customer = f.customers[0].customer!;
  await prisma.rewardEntry.create({
    data: {
      customerId: customer.id,
      entryKey: randomUUID(),
      kind: "REFERRAL",
      amountCents: 8000,
      sourceId: randomUUID(),
      description: "Synthetic test credit; no provider event",
    },
  });
  const promo = {
    code: `T${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    name: "Synthetic ten percent",
    valueType: "PERCENT",
    value: 1000,
    startsOn: businessDate(),
    endsOn: businessDate(),
    minimumPurchaseCents: 1000,
    maximumDiscountCents: null,
    audience: "ALL",
    allowRewards: true,
    isActive: true,
    version: 0,
  };
  await expect(savePromotion(f.customers[0].id, promo)).rejects.toMatchObject({
    status: 403,
  });
  await savePromotion(f.admin.id, promo);
  const request = {
    lines: [{ variantId: variant.id, quantity: 1 }],
    promotionCode: promo.code,
  };
  const quote = await quoteCartRewards(f.customers[0].id, request);
  expect(quote).toMatchObject({
    merchandiseCents: 3500,
    discountCents: 350,
    appliedCents: 3150,
    remainingCents: 4850,
    payableCents: 0,
    previewOnly: true,
  });
  await expect(savePromotion(f.admin.id, promo)).rejects.toMatchObject({ status: 409 });
  await savePromotion(f.admin.id, { ...promo, allowRewards: false, version: 1 });
  expect(await quoteCartRewards(f.customers[0].id, request)).toMatchObject({
    appliedCents: 0,
    remainingCents: 8000,
    payableCents: 3150,
  });
  expect(
    await prisma.rewardEntry.aggregate({
      where: { customerId: customer.id },
      _sum: { amountCents: true },
    }),
  ).toMatchObject({ _sum: { amountCents: 8000 } });
  expect(
    await prisma.rewardReservation.count({ where: { customerId: customer.id } }),
  ).toBe(0);
});
it("requires owned validated addresses plus approval, even for two customers sharing a ZIP", async () => {
  const zone = await createLaunchResource(f.admin.id, {
    type: "zone",
    name: `Synthetic area ${f.marker}`,
    postalCodes: ["60103"],
    requestKey: randomUUID(),
  });
  resources.push({ ...zone, type: "zone" });
  const a = f.customers[0],
    b = f.customers[1];
  await prisma.address.updateMany({
    where: { customerId: { in: [a.customer!.id, b.customer!.id] } },
    data: { postalCode: "60103", deliveryZoneId: zone.id },
  });
  await prisma.customer.update({
    where: { id: a.customer!.id },
    data: { purchaseApprovedAt: new Date() },
  });
  expect(await purchaseEligibility(a.id, "60103")).toMatchObject({
    areaAvailable: true,
    eligible: false,
  });
  await prisma.address.update({
    where: { id: a.customer!.addresses[0].id },
    data: { validatedAt: new Date(), validationSource: "SYNTHETIC_TEST_ONLY" },
  });
  expect(await purchaseEligibility(a.id, "60103")).toMatchObject({
    eligible: true,
    canPurchase: false,
  });
  expect(await purchaseEligibility(b.id, "60103")).toMatchObject({
    eligible: false,
    canPurchase: false,
  });
  expect(await purchaseEligibility(null, "60103")).toMatchObject({ eligible: false });
  await expect(
    createLaunchResource(f.admin.id, {
      type: "zone",
      name: "Conflicting synthetic area",
      postalCodes: ["60103"],
      requestKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("serializes launch saves, locks cadence/ZIP edits and protects booked vehicle capacity", async () => {
  const zone = resources.find((r) => r.type === "zone")!;
  const vehicle = await createLaunchResource(f.admin.id, {
    type: "vehicle",
    name: `Synthetic van ${f.marker}`,
    capacityStops: 20,
    capacityUnits: 20,
    detergentBucketLimit: 20,
    scentBeadBucketLimit: 20,
    requestKey: randomUUID(),
  });
  resources.push({ ...vehicle, type: "vehicle" });
  const current = await launchConfig();
  const data = {
    ...defaultLaunch,
    version: current.version,
    enabled: true,
    cadences: [
      {
        zoneId: zone.id,
        vehicleId: vehicle.id,
        weeks: [3, 4, 5],
        weekday: 4,
        locked: true,
      },
    ],
  };
  const raced = await Promise.allSettled([
    saveLaunch(f.admin.id, data),
    saveLaunch(f.admin.id, data),
  ]);
  expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const latest = await launchConfig();
  await expect(
    saveLaunch(f.admin.id, {
      ...latest,
      cadences: [{ ...latest.cadences[0], weekday: 5 }],
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    saveZoneZips(f.admin.id, { id: zone.id, postalCodes: ["60104"] }),
  ).rejects.toMatchObject({ status: 409 });
  await prisma.route.update({
    where: { id: f.route.id },
    data: { vehicleId: vehicle.id },
  });
  const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
  await expect(
    saveVehicleCapacity(f.admin.id, {
      id: v.id,
      updatedAt: v.updatedAt.toISOString(),
      capacityStops: 1,
      capacityUnits: 1,
      detergentBucketLimit: 1,
      scentBeadBucketLimit: 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const before = await prisma.routeStop.findMany({
    where: { routeId: f.route.id },
    orderBy: { sequence: "asc" },
  });
  await launchDemand(f.admin.id);
  expect(
    await prisma.routeStop.findMany({
      where: { routeId: f.route.id },
      orderBy: { sequence: "asc" },
    }),
  ).toEqual(before);
});
