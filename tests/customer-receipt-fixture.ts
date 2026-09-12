import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
/** Isolated synthetic financial records; never import this helper from application code. */
export async function receiptFixture(
  db: PrismaClient,
  options: {
    passwordHash?: string;
    financialEvidence?: boolean;
    zero?: boolean;
    pending?: boolean;
    badTotal?: boolean;
    unverified?: boolean;
  } = {},
) {
  const marker = randomUUID();
  const role = await db.role.upsert({
    where: { code: "CUSTOMER" },
    update: {},
    create: { code: "CUSTOMER", name: "Customer" },
  });
  const user = await db.user.create({
    data: {
      email: `receipt-${marker}@example.test`,
      passwordHash: options.passwordHash,
      userRoles: { create: { roleId: role.id } },
      customer: { create: { firstName: "Synthetic Receipt" } },
    },
    include: { customer: true },
  });
  const product = await db.product.create({
    data: {
      name: "Current catalog name",
      slug: marker,
      brand: "Synthetic",
      variants: { create: { name: "Current variant", sku: marker } },
    },
    include: { variants: true },
  });
  const variant = product.variants[0];
  const rewards = options.zero ? 2700 : 600,
    net = options.zero ? 0 : 2100,
    tax = options.zero ? 0 : 168,
    total = net + tax;
  const order = await db.order.create({
    data: {
      number: `RECEIPT-${marker}`,
      customerId: user.customer!.id,
      status: "DELIVERED",
      placedAt: new Date("2026-02-01T18:00:00Z"),
      subtotalCents: 3000,
      discountCents: 300 + rewards,
      taxCents: tax,
      totalCents: total,
      items: {
        create: {
          productVariantId: variant.id,
          nameSnapshot: "Original detergent bucket",
          skuSnapshot: "ORIGINAL-SKU",
          quantity: 3,
          unitPriceCents: 1000,
          discountCents: 300 + rewards,
          taxCents: tax,
          lineTotalCents: total,
        },
      },
      checkoutAttempt: {
        create: {
          customerId: user.customer!.id,
          state: options.pending ? "OPEN" : "PAID",
          requestKey: marker,
          requestHash: marker,
          expiresAt: new Date(),
          livemode: false,
          stripeAccountId: "acct_synthetic_receipt",
          stripeSessionId: "cs_" + marker,
          snapshot: {
            address: {
              line1: "1 Synthetic Street",
              line2: "Unit 2",
              city: "Synthetic",
              region: "IL",
              postalCode: "60000",
              country: "US",
              lat: 1,
              lng: 2,
            },
            launchDate: "2026-02-01",
            firstDeliveryBy: "2026-02-07",
            subtotalCents: 3000,
            promotionCents: 300,
            rewardsCents: rewards,
            taxCents: tax,
            totalCents: options.badTotal ? total + 1 : total,
            lines: [
              {
                variantId: variant.id,
                name: "Original detergent bucket",
                sku: "ORIGINAL-SKU",
                quantity: 3,
                unitPriceCents: 1000,
                discountCents: 300 + rewards,
                netCents: net,
                taxCode: "txcd_synthetic",
              },
            ],
            email: "private-snapshot@example.test",
            taxCalculationId: "private-tax-id",
            taxBreakdown: [{ amount: tax }],
            dates: ["2026-02-01"],
            vehicleId: "private-vehicle",
          },
        },
      },
    },
    include: { checkoutAttempt: true },
  });
  const checkoutId = order.checkoutAttempt!.id;
  await db.payment.create({
    data: {
      orderId: order.id,
      provider: "STRIPE",
      status: "CAPTURED",
      amountCents: total,
      externalId: `pi_private_${marker}`,
      events: {
        create: {
          externalId: `checkout:${checkoutId}:paid`,
          type: "checkout.session.completed",
          verifiedAt: options.unverified ? null : new Date(),
        },
      },
    },
  });
  if (options.financialEvidence) {
    await db.taxCalculation.create({
      data: {
        orderId: order.id,
        provider: "STRIPE_QUOTE",
        taxableCents: net,
        taxCents: tax,
        externalId: "private-tax-id",
        breakdownJson: [{ amount: tax }],
        destinationJson: {
          line1: "1 Synthetic Street",
          line2: "Unit 2",
          city: "Synthetic",
          region: "IL",
          postalCode: "60000",
          country: "US",
        },
      },
    });
    const hold = await db.rewardReservation.create({
      data: {
        orderId: order.id,
        customerId: user.customer!.id,
        amountCents: rewards,
        orderTotalCents: total + rewards,
        requestKey: randomUUID(),
        state: "USED",
      },
    });
    await db.rewardEntry.create({
      data: {
        customerId: user.customer!.id,
        orderId: order.id,
        sourceId: hold.id,
        kind: "REDEMPTION",
        amountCents: -rewards,
        description: "Synthetic ledger fixture",
        entryKey: `order:${order.id}:use`,
      },
    });
    await db.auditLog.create({
      data: {
        entityType: "Order",
        entityId: order.id,
        action: "checkout.payment.finalized",
        afterJson: {
          sessionId: "cs_" + marker,
          amount: total,
          currency: "usd",
          livemode: false,
          paymentStatus: "paid",
          status: "complete",
          rewardsUsedCents: rewards,
          taxLines: [{ variantId: variant.id, netCents: net, taxCents: tax }],
        },
      },
    });
    const layer = await db.inventoryCostLayer.create({
      data: {
        productVariantId: variant.id,
        quantityOriginal: 3,
        quantityRemaining: 0,
        landedUnitCostCents: 400,
        receivedAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await db.checkoutCostAllocation.create({
      data: {
        checkoutId,
        costLayerId: layer.id,
        quantity: 3,
        unitCostCents: 400,
        state: "CONSUMED",
      },
    });
  }
  return {
    userId: user.id,
    email: user.email,
    checkoutId,
    orderId: order.id,
    productId: product.id,
  };
}
