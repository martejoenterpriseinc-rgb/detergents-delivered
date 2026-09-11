import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { customerIdentity } from "@/lib/services/customer-account";
import { launchConfig } from "@/lib/services/launch";
import { quotePromotion } from "@/lib/services/promotions";
import { rewardBalance } from "@/lib/services/loyalty";
import { businessDate } from "@/lib/domain/operations";
import {
  cadenceDates,
  zonePostalCodes,
  deliveryBookingWindow,
} from "@/lib/domain/launch";
import { AccountError } from "@/lib/domain/account";
import { pickCurrentPrice } from "@/lib/prices";
import {
  checkoutInput,
  canonicalJson,
  allocateCents,
  type CheckoutInput,
  type CheckoutSnapshot,
} from "./domain";
import { readCommerce } from "./runtime";
import { calculateCheckoutTax } from "./stripe";
export const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const fingerprint = (v: unknown) =>
  createHash("sha256").update(canonicalJson(v)).digest("hex");
export async function buildSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
  input: CheckoutInput,
): Promise<CheckoutSnapshot> {
  const { user, customer } = await customerIdentity(tx, userId);
  if (!user.emailVerified || !customer.purchaseApprovedAt)
    throw new AccountError(
      "Your account needs email verification and purchase approval.",
      403,
    );
  const address = await tx.address.findFirst({
    where: { id: input.addressId, customerId: customer.id, deletedAt: null },
    include: { deliveryZone: true },
  });
  if (
    !address?.validatedAt ||
    !address.validationSource ||
    address.lat === null ||
    address.lng === null ||
    address.country !== "US" ||
    !address.deliveryZone?.isActive ||
    !zonePostalCodes(address.deliveryZone.boundaryJson).includes(address.postalCode)
  )
    throw new AccountError("Choose an approved delivery address in an active area.", 409);
  const matches = (await tx.deliveryZone.findMany({ where: { isActive: true } })).filter(
    (z) => zonePostalCodes(z.boundaryJson).includes(address.postalCode),
  );
  if (matches.length !== 1) throw new AccountError("Delivery area needs review.", 409);
  const launch = await launchConfig(tx);
  const today = businessDate();
  const window = deliveryBookingWindow(launch, today);
  if (!window) throw new AccountError("The order window is closed.", 409);
  const cadence = launch.cadences.find(
    (c) => c.zoneId === address.deliveryZoneId && c.locked,
  );
  if (!cadence)
    throw new AccountError(
      "Delivery capacity for this area is not open for booking yet.",
      409,
    );
  const dates = cadenceDates(cadence, window.start, window.end);
  if (!dates.length)
    throw new AccountError(
      "No delivery dates are available in this booking window.",
      409,
    );
  const lines = [];
  for (const item of [...input.lines].sort((a, b) =>
    a.variantId.localeCompare(b.variantId),
  )) {
    const v = await tx.productVariant.findFirst({
      where: {
        id: item.variantId,
        isActive: true,
        websiteVisible: true,
        deletedAt: null,
        product: { isActive: true, websiteVisible: true, deletedAt: null },
      },
      include: { product: true, prices: true, inventoryBalance: true },
    });
    const price =
      v && (pickCurrentPrice(v.prices, new Date(), "SALE") ?? pickCurrentPrice(v.prices));
    const taxCode = v?.taxCategory || v?.product.taxCategory;
    if (
      !v ||
      !price ||
      price.amountCents < 1 ||
      !taxCode ||
      !/^txcd_\d{8}$/.test(taxCode)
    )
      throw new AccountError(
        "A product is unavailable or needs its tax category configured.",
        409,
      );
    if (
      (v.inventoryBalance?.onHandQty ?? 0) - (v.inventoryBalance?.reservedQty ?? 0) <
      item.quantity
    )
      throw new AccountError(`Not enough available stock for ${v.product.name}.`, 409);
    const spaceUnits = v.deliveryCapacityUnits ?? v.product.deliveryCapacityUnits;
    if (spaceUnits < 1 || (v.casePack ?? 1) > 1)
      throw new AccountError(
        "This product's vehicle load needs review. Case packs are not enabled for checkout.",
        409,
      );
    lines.push({
      variantId: v.id,
      name: `${v.product.name} · ${v.name}`,
      sku: v.sku,
      quantity: item.quantity,
      unitPriceCents: price.amountCents,
      discountCents: 0,
      netCents: item.quantity * price.amountCents,
      taxCode,
      spaceUnits,
      loadKind: v.product.loadKind,
    });
  }
  const subtotalCents = lines.reduce((a, l) => a + l.netCents, 0);
  if (subtotalCents > 1000000)
    throw new AccountError("Order exceeds the online checkout limit.", 409);
  const promo = await quotePromotion(tx, customer.id, input.promotionCode, subtotalCents);
  const wallet = await rewardBalance(tx, customer.id);
  const rewardsCents =
    input.useRewards && promo.allowRewards
      ? Math.min(wallet.availableCents, subtotalCents - promo.discountCents)
      : 0;
  if (input.useRewards && !promo.allowRewards)
    throw new AccountError("This promotion cannot be combined with rewards.", 409);
  const discounts = allocateCents(
    promo.discountCents + rewardsCents,
    lines.map((l) => l.netCents),
  );
  lines.forEach((l, i) => {
    l.discountCents = discounts[i];
    l.netCents -= discounts[i];
  });
  return {
    input,
    email: user.email!,
    name: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Customer",
    address: {
      id: address.id,
      version: address.updatedAt.toISOString(),
      line1: address.line1,
      line2: address.line2 ?? "",
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      country: address.country,
      lat: address.lat,
      lng: address.lng,
    },
    zoneId: address.deliveryZoneId!,
    launchVersion: launch.version,
    launchDate: window.start,
    firstDeliveryBy: window.end,
    vehicleId: cadence.vehicleId,
    dates,
    lines,
    subtotalCents,
    promotionCents: promo.discountCents,
    rewardsCents,
    promotion: promo.promotion
      ? {
          id: promo.promotion.id,
          version: promo.promotion.version,
          audience: promo.promotion.audience,
        }
      : null,
    taxCents: 0,
    totalCents: subtotalCents - promo.discountCents - rewardsCents,
    taxCalculationId: "",
    taxBreakdown: [],
  };
}
export async function createQuote(userId: string, raw: unknown) {
  const config = await readCommerce();
  const input = checkoutInput.parse(raw);
  input.lines.sort((a, b) => a.variantId.localeCompare(b.variantId));
  const { customer } = await customerIdentity(prisma, userId);
  const key = { customerId: customer.id, requestKey: input.requestKey };
  const hash = fingerprint(input);
  const prior = await prisma.checkoutAttempt.findUnique({
    where: { customerId_requestKey: key },
  });
  if (prior) {
    if (prior.requestHash !== hash)
      throw new AccountError("Checkout request changed. Review your cart again.", 409);
    return publicCheckout(prior);
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customer.id} FOR UPDATE`;
    const attempts = await tx.auditLog.count({
      where: {
        entityType: "Customer",
        entityId: customer.id,
        action: "checkout.quote.requested",
        createdAt: { gte: new Date(Date.now() - 120000) },
      },
    });
    if (attempts >= 8)
      throw new AccountError(
        "Too many checkout requests. Wait two minutes and retry.",
        429,
      );
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "checkout.quote.requested",
        entityType: "Customer",
        entityId: customer.id,
      },
    });
  });
  const snapshot = await prisma.$transaction((tx) => buildSnapshot(tx, userId, input), {
    isolationLevel: "RepeatableRead",
  });
  Object.assign(snapshot, await calculateCheckoutTax(snapshot));
  const expected =
    snapshot.subtotalCents -
    snapshot.promotionCents -
    snapshot.rewardsCents +
    snapshot.taxCents;
  if (snapshot.totalCents !== expected || snapshot.taxCents < 0)
    throw new AccountError("Tax quote could not be confirmed.", 503);
  const attempt = await prisma.checkoutAttempt.upsert({
    where: { customerId_requestKey: key },
    update: {},
    create: {
      ...key,
      requestHash: hash,
      snapshot: json(snapshot),
      expiresAt: new Date(Date.now() + 5 * 60000),
      stripeAccountId: config.accountId,
      livemode: config.live,
    },
  });
  if (attempt.requestHash !== hash)
    throw new AccountError("Checkout request changed.", 409);
  return publicCheckout(attempt);
}
export function publicCheckout(a: {
  id: string;
  state: string;
  snapshot: Prisma.JsonValue;
  expiresAt: Date;
  orderId: string | null;
  lastError: string | null;
}) {
  const s = a.snapshot as unknown as CheckoutSnapshot;
  return {
    id: a.id,
    state: a.state,
    expiresAt: a.expiresAt.toISOString(),
    orderId: a.orderId,
    subtotalCents: s.subtotalCents,
    promotionCents: s.promotionCents,
    rewardsCents: s.rewardsCents,
    taxCents: s.taxCents,
    totalCents: s.totalCents,
    launchDate: s.launchDate,
    firstDeliveryBy: s.firstDeliveryBy,
    lines: s.lines,
    address: `${s.address.line1}, ${s.address.city}, ${s.address.region} ${s.address.postalCode}`,
    needsReview: a.state === "REVIEW",
  };
}
