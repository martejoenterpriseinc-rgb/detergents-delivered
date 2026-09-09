import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import { customerIdentity } from "@/lib/services/customer-account";
import { rewardBalance } from "@/lib/services/loyalty";
import { persistInventoryTransaction } from "@/lib/services/inventory-ledger";
import { checkoutLock, reserveCheckout } from "./reservations";
import { requireCommerce } from "./config";
import { assertSessionIdentity, createStripeCheckout, stripeClient } from "./stripe";
import { json, publicCheckout } from "./quote";
import { type CheckoutSnapshot, heldStates } from "./domain";

export async function ownedCheckout(userId: string, id: string) {
  const { customer } = await customerIdentity(prisma, userId);
  const a = await prisma.checkoutAttempt.findFirst({
    where: { id, customerId: customer.id },
  });
  if (!a) throw new AccountError("Checkout not found.", 404);
  return a;
}
export async function beginCheckout(userId: string, id: string, accepted: boolean) {
  const a = await reserveCheckout(userId, id, accepted);
  if (!heldStates.includes(a.state)) return { ...publicCheckout(a), url: null };
  if (a.state === "REVIEW")
    throw new AccountError("Your checkout needs support review. Do not pay again.", 409);
  const s = a.snapshot as unknown as CheckoutSnapshot;
  try {
    const result = a.stripeSessionId
      ? {
          session: await stripeClient().checkout.sessions.retrieve(a.stripeSessionId),
          customerId: a.stripeCustomerId,
        }
      : await createStripeCheckout(a.id, s, a.sessionExpiresAt!);
    await prisma.checkoutAttempt.updateMany({
      where: { id: a.id, stripeSessionId: null },
      data: { stripeSessionId: result.session.id, stripeCustomerId: result.customerId },
    });
    assertSessionIdentity(result.session, a.id, s, a.livemode);
    if (result.session.status !== "open") {
      await reconcileCheckout(a.id);
      return { ...publicCheckout(await ownedCheckout(userId, id)), url: null };
    }
    await prisma.checkoutAttempt.updateMany({
      where: { id, state: "PREPARING" },
      data: { state: "OPEN", lastError: null },
    });
    const url = result.session.url;
    if (
      !url ||
      new URL(url).hostname !== "checkout.stripe.com" ||
      !url.startsWith("https://")
    )
      throw new Error("Unexpected checkout URL");
    return { ...publicCheckout(await ownedCheckout(userId, id)), url };
  } catch {
    await prisma.checkoutAttempt.updateMany({
      where: { id, state: { in: ["PREPARING", "OPEN"] } },
      data: { lastError: "PAYMENT_SETUP_UNCONFIRMED" },
    });
    throw new AccountError(
      "Payment setup could not be confirmed. Your reservation is protected. Retry this checkout or contact support; do not start another payment.",
      503,
    );
  }
}

/** Only call with data fetched from the pinned Stripe account, after signature verification or authenticated reconciliation. */
export async function settleVerifiedSession(
  session: Stripe.Checkout.Session,
  evidence: { id: string; type: string; source: "webhook" | "reconciliation" },
  taxLines: { variantId: string; netCents: number; taxCents: number }[],
) {
  const id = session.client_reference_id;
  if (!id) return;
  const original = await prisma.checkoutAttempt.findUnique({ where: { id } });
  if (!original) return;
  const config = requireCommerce(true);
  if (original.stripeAccountId !== config.accountId || original.livemode !== config.live)
    throw new AccountError("Payment environment mismatch.", 409);
  await prisma.$transaction(
    async (tx) => {
      await checkoutLock(tx, original.customerId);
      const a = await tx.checkoutAttempt.findUniqueOrThrow({ where: { id } });
      if (!a.orderId) throw new AccountError("Payment has no reserved order.", 409);
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${a.orderId} FOR UPDATE`;
      const s = a.snapshot as unknown as CheckoutSnapshot;
      if (
        session.livemode !== a.livemode ||
        session.metadata?.checkoutId !== id ||
        session.metadata?.project !== "detergents-delivered" ||
        (a.stripeSessionId && a.stripeSessionId !== session.id)
      )
        throw new AccountError("Payment session mismatch.", 409);
      const record = {
        sessionId: session.id,
        paymentStatus: session.payment_status,
        status: session.status,
        amount: session.amount_total,
        currency: session.currency,
        livemode: session.livemode,
        source: evidence.source,
      };
      await tx.checkoutProviderEvent.upsert({
        where: { id: evidence.id },
        update: {},
        create: {
          id: evidence.id,
          checkoutId: id,
          type: evidence.type,
          evidence: json(record),
          verifiedAt: new Date(),
        },
      });
      if (["PAID", "EXPIRED", "REFUNDED"].includes(a.state)) return;
      await tx.checkoutAttempt.update({
        where: { id },
        data: { stripeSessionId: session.id },
      });
      if (session.status === "expired" && session.payment_status === "unpaid") {
        for (const line of s.lines)
          await persistInventoryTransaction(tx, {
            productVariantId: line.variantId,
            type: "RESERVATION_RELEASE",
            quantity: line.quantity,
            referenceType: "CheckoutAttempt",
            referenceId: id,
          });
        await tx.rewardReservation.updateMany({
          where: { orderId: a.orderId, state: "HELD" },
          data: { state: "RELEASED" },
        });
        await tx.checkoutCostAllocation.updateMany({
          where: { checkoutId: id, state: "HELD" },
          data: { state: "RELEASED" },
        });
        await tx.order.update({
          where: { id: a.orderId },
          data: { status: "CANCELLED" },
        });
        await tx.checkoutAttempt.update({
          where: { id },
          data: { state: "EXPIRED", lastError: null },
        });
        await tx.auditLog.create({
          data: {
            action: "checkout.expired.released",
            entityType: "CheckoutAttempt",
            entityId: id,
            afterJson: record,
          },
        });
        return;
      }
      if (
        session.status !== "complete" ||
        !["paid", "no_payment_required"].includes(session.payment_status)
      ) {
        await tx.checkoutAttempt.update({
          where: { id },
          data: { state: session.status === "complete" ? "PROCESSING" : "OPEN" },
        });
        return;
      }
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${a.vehicleId} FOR UPDATE`;
      // A driver may start a route after checkout was reserved but before payment clears.
      await tx.$queryRaw`SELECT id FROM "Route" WHERE "vehicleId" = ${a.vehicleId} AND "serviceDate" = ${new Date(a.serviceDate!)} ORDER BY id FOR UPDATE`;
      const departed = await tx.route.count({
        where: {
          vehicleId: a.vehicleId,
          serviceDate: new Date(a.serviceDate!),
          status: { in: ["IN_PROGRESS", "COMPLETED"] },
        },
      });
      try {
        if (!a.serviceDate || a.serviceDate < businessDate() || departed)
          throw new Error("Reserved delivery needs staff review");
        assertSessionIdentity(session, id, s, a.livemode);
        if (session.payment_status === "no_payment_required" && s.totalCents !== 0)
          throw new Error("Missing payment");
        if (session.payment_status === "paid" && !session.payment_intent)
          throw new Error("Missing payment intent");
        if (
          taxLines.length !== s.lines.length ||
          new Set(taxLines.map((l) => l.variantId)).size !== s.lines.length ||
          taxLines.reduce((n, l) => n + l.taxCents, 0) !== s.taxCents ||
          s.lines.some((l) => {
            const t = taxLines.find((t) => t.variantId === l.variantId);
            return (
              !t ||
              t.netCents !== l.netCents ||
              !Number.isSafeInteger(t.taxCents) ||
              t.taxCents < 0
            );
          })
        )
          throw new Error("Line totals changed");
        const wallet = await rewardBalance(tx, a.customerId);
        if (s.rewardsCents && wallet.balanceCents < wallet.heldCents)
          throw new Error("Wallet changed");
      } catch {
        await tx.checkoutAttempt.update({
          where: { id },
          data: { state: "REVIEW", lastError: "PAYMENT_REQUIRES_RECONCILIATION" },
        });
        await tx.auditLog.create({
          data: {
            action: "checkout.payment.review",
            entityType: "CheckoutAttempt",
            entityId: id,
            afterJson: record,
          },
        });
        return;
      }
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
        const chosen = allocations.filter((c) =>
          layers.some((l) => l.id === c.costLayerId),
        );
        if (chosen.reduce((n, c) => n + c.quantity, 0) !== line.quantity)
          throw new Error("Cost reservations do not match");
        costs[line.variantId] = chosen.reduce(
          (n, c) => n + c.quantity * c.unitCostCents,
          0,
        );
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
      const externalId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? session.id);
      const payment = await tx.payment.create({
        data: {
          orderId: a.orderId,
          provider: "STRIPE",
          status: "CAPTURED",
          amountCents: s.totalCents,
          externalId,
          idempotencyKey: `checkout:${id}`,
        },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          type:
            evidence.source === "webhook"
              ? "checkout.session.completed"
              : "checkout.session.reconciled",
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
    },
    { timeout: 20000, maxWait: 10000 },
  );
}
export async function reconcileCheckout(
  id: string,
  event?: { id: string; type: string },
) {
  const a = await prisma.checkoutAttempt.findUnique({ where: { id } });
  if (!a?.stripeSessionId)
    throw new AccountError(
      "Payment setup is not confirmed. Retry the same checkout or contact support.",
      409,
    );
  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.retrieve(a.stripeSessionId);
  const lines =
    session.status === "complete"
      ? await stripe.checkout.sessions.listLineItems(session.id, {
          limit: 100,
          expand: ["data.price.product"],
        })
      : null;
  if (lines?.has_more) throw new Error("Unexpected line item pagination");
  const taxLines = (lines?.data ?? []).map((l) => {
    const product = l.price?.product;
    return {
      variantId:
        typeof product === "object" && product && !product.deleted
          ? product.metadata.variantId
          : "",
      netCents: l.amount_subtotal,
      taxCents: l.amount_tax,
    };
  });
  await settleVerifiedSession(
    session,
    {
      id:
        event?.id ??
        `reconcile:${session.id}:${session.status}:${session.payment_status}`,
      type: event?.type ?? "checkout.session.reconciled",
      source: event ? "webhook" : "reconciliation",
    },
    taxLines,
  );
}
export async function cancelCheckout(userId: string, id: string) {
  const a = await ownedCheckout(userId, id);
  if (a.state === "QUOTED") {
    await prisma.checkoutAttempt.updateMany({
      where: { id, state: "QUOTED" },
      data: { state: "EXPIRED" },
    });
    return;
  }
  if (!a.stripeSessionId)
    throw new AccountError(
      "Payment creation must be reconciled before cancellation. Contact support.",
      409,
    );
  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.retrieve(a.stripeSessionId);
  if (session.status === "open")
    await stripe.checkout.sessions.expire(
      session.id,
      {},
      { idempotencyKey: `dd:${id}:expire` },
    );
  await reconcileCheckout(id);
}
