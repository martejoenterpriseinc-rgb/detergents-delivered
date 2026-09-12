import type { Prisma, CheckoutAttempt, PaymentProvider } from "@prisma/client";
import { AccountError } from "@/lib/domain/account";
import { persistInventoryTransaction } from "@/lib/services/inventory-ledger";
import { rewardBalance } from "@/lib/services/loyalty";
import { settleSubscriptionCycle } from "@/lib/services/subscription-cycles";
import { json } from "./quote";
import type { CheckoutSnapshot } from "./domain";
/** Caller must hold checkout/customer/order/vehicle locks and verify payment and tax evidence. */
export async function finalizeReservedCheckout(
  tx: Prisma.TransactionClient,
  a: CheckoutAttempt,
  s: CheckoutSnapshot,
  taxLines: { variantId: string; netCents: number; taxCents: number }[],
  paymentData: {
    provider: PaymentProvider;
    externalId: string;
    eventType: string;
    record: Record<string, unknown>;
  },
) {
  if (!a.orderId || !a.serviceDate)
    throw new AccountError("Reserved order is missing.", 409);
  const id = a.id,
    record = paymentData.record;
  // Preserve a historical address even if the household changes its default later.
  const address = await tx.address.create({
    data: {
      customerId: a.customerId,
      line1: s.address.line1,
      line2: s.address.line2 || null,
      city: s.address.city,
      region: s.address.region,
      postalCode: s.address.postalCode,
      country: s.address.country,
      lat: s.address.lat,
      lng: s.address.lng,
      deliveryZoneId: a.zoneId,
      label: "Order delivery snapshot",
      isDefault: false,
      validatedAt: new Date(),
      validationSource: `CHECKOUT_SNAPSHOT:${s.address.id}`,
    },
  });
  const allocations = await tx.checkoutCostAllocation.findMany({
    where: { checkoutId: id, state: "HELD" },
  });
  const costs: Record<string, number> = {};
  for (const line of s.lines) {
    await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${line.variantId} FOR UPDATE`;
    const layers = await tx.inventoryCostLayer.findMany({
      where: { productVariantId: line.variantId },
    });
    const chosen = allocations.filter((c) => layers.some((l) => l.id === c.costLayerId));
    if (chosen.reduce((n, c) => n + c.quantity, 0) !== line.quantity)
      throw new Error("Cost reservations do not match");
    costs[line.variantId] = chosen.reduce((n, c) => n + c.quantity * c.unitCostCents, 0);
    for (const c of chosen) {
      const applied = await tx.inventoryCostLayer.updateMany({
        where: { id: c.costLayerId, quantityRemaining: { gte: c.quantity } },
        data: { quantityRemaining: { decrement: c.quantity } },
      });
      if (applied.count !== 1) throw new Error("Cost layer unavailable");
    }
    await persistInventoryTransaction(tx, {
      productVariantId: line.variantId,
      type: "SALE",
      quantity: line.quantity,
      referenceType: "Order",
      referenceId: a.orderId,
    });
    const tax = taxLines.find((t) => t.variantId === line.variantId)!.taxCents;
    await tx.orderItem.updateMany({
      where: { orderId: a.orderId, productVariantId: line.variantId },
      data: {
        taxCents: tax,
        lineTotalCents: line.netCents + tax,
        landedUnitCostCents: Math.round(costs[line.variantId] / line.quantity),
      },
    });
  }
  await tx.checkoutCostAllocation.updateMany({
    where: { checkoutId: id, state: "HELD" },
    data: { state: "CONSUMED" },
  });
  if (s.rewardsCents) {
    const hold = await tx.rewardReservation.findUnique({
      where: { orderId: a.orderId },
    });
    if (!hold || hold.state !== "HELD" || hold.amountCents !== s.rewardsCents)
      throw new Error("Reward hold missing");
    await tx.rewardEntry.create({
      data: {
        customerId: a.customerId,
        orderId: a.orderId,
        kind: "REDEMPTION",
        amountCents: -s.rewardsCents,
        entryKey: `order:${a.orderId}:use`,
        sourceId: hold.id,
        description: "Reward credit applied to purchase",
      },
    });
    await tx.rewardReservation.update({
      where: { id: hold.id },
      data: { state: "USED" },
    });
  }
  const payment = await tx.payment.create({
    data: {
      orderId: a.orderId,
      provider: paymentData.provider,
      status: "CAPTURED",
      amountCents: s.totalCents,
      externalId: paymentData.externalId,
      idempotencyKey: `checkout:${id}`,
    },
  });
  await tx.paymentEvent.create({
    data: {
      paymentId: payment.id,
      type: paymentData.eventType,
      externalId: `checkout:${id}:paid`,
      payload: json(record),
      verifiedAt: new Date(),
    },
  });
  await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${a.vehicleId} FOR UPDATE`;
  let route = await tx.route.findFirst({
    where: {
      vehicleId: a.vehicleId,
      deliveryZoneId: a.zoneId,
      serviceDate: new Date(a.serviceDate!),
      status: "SCHEDULED",
    },
  });
  if (!route)
    route = await tx.route.create({
      data: {
        number: `DD-${a.vehicleId}-${a.zoneId}-${a.serviceDate}`,
        vehicleId: a.vehicleId,
        deliveryZoneId: a.zoneId,
        serviceDate: new Date(a.serviceDate!),
        status: "SCHEDULED",
      },
    });
  const sequence =
    (
      await tx.routeStop.aggregate({
        where: { routeId: route.id },
        _max: { sequence: true },
      })
    )._max.sequence ?? 0;
  await tx.routeStop.create({
    data: {
      routeId: route.id,
      orderId: a.orderId,
      addressId: address.id,
      sequence: sequence + 1,
    },
  });
  await tx.order.update({
    where: { id: a.orderId },
    data: { status: "PAID", placedAt: new Date(), addressId: address.id },
  });
  const wallet = await rewardBalance(tx, a.customerId);
  await tx.checkoutAttempt.update({
    where: { id },
    data: { state: "PAID", lastError: null },
  });
  await settleSubscriptionCycle(tx, id, a.customerId, a.subscriptionCycleId);
  await tx.auditLog.create({
    data: {
      action: "checkout.payment.finalized",
      entityType: "Order",
      entityId: a.orderId,
      afterJson: json({
        ...record,
        rewardsUsedCents: s.rewardsCents,
        remainingRewardsCents: wallet.availableCents,
        exactCostCents: costs,
        taxLines,
        address: s.address,
        promisedWindow: [s.launchDate, s.firstDeliveryBy],
      }),
    },
  });
}
