import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { customerIdentity } from "@/lib/services/customer-account";
import { persistInventoryTransaction } from "@/lib/services/inventory-ledger";
import { addLoad, emptyLoad, fitsVehicle, loadForItems } from "@/lib/domain/launch";
import { buildSnapshot, fingerprint, json } from "./quote";
import { capacityStates, heldStates, type CheckoutSnapshot } from "./domain";
import { readCommerce } from "./runtime";

export async function checkoutLock(tx: Prisma.TransactionClient, customerId: string) {
  // Short database transactions only. Never hold this lock while calling Stripe.
  // All checkout transitions share lock ordering with the wallet and inventory ledgers.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(613279107)`;
  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
}
export async function reserveCheckout(
  userId: string,
  id: string,
  acceptedWindow: boolean,
) {
  const config = await readCommerce();
  return prisma.$transaction(
    async (tx) => {
      const { customer } = await customerIdentity(tx, userId);
      await checkoutLock(tx, customer.id);
      const a = await tx.checkoutAttempt.findFirst({
        where: { id, customerId: customer.id },
      });
      if (!a) throw new AccountError("Checkout not found.", 404);
      if (a.stripeAccountId !== config.accountId || a.livemode !== config.live)
        throw new AccountError("Checkout environment changed.", 409);
      if (a.state !== "QUOTED") return a;
      if (!acceptedWindow)
        throw new AccountError("Accept the first delivery window before payment.");
      if (a.expiresAt <= new Date())
        throw new AccountError("This quote expired. Review your cart again.", 409);
      const saved = a.snapshot as unknown as CheckoutSnapshot;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(613279105)`;
      await tx.$queryRaw`SELECT id FROM "Address" WHERE id = ${saved.address.id} FOR UPDATE`;
      for (const line of saved.lines)
        await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${line.variantId} FOR UPDATE`;
      const current = await buildSnapshot(tx, userId, saved.input);
      const {
        taxCents: _t,
        totalCents: _v,
        taxCalculationId: _c,
        taxBreakdown: _b,
        ...oldBase
      } = saved;
      const {
        taxCents: _t2,
        totalCents: _v2,
        taxCalculationId: _c2,
        taxBreakdown: _b2,
        ...newBase
      } = current;
      void [_t, _v, _c, _b, _t2, _v2, _c2, _b2];
      if (fingerprint(oldBase) !== fingerprint(newBase))
        throw new AccountError(
          "Prices, address, rewards or delivery terms changed. Review your cart again.",
          409,
        );
      if (
        await tx.checkoutAttempt.count({
          where: { customerId: customer.id, state: { in: heldStates } },
        })
      )
        throw new AccountError(
          "Finish or cancel your existing checkout before starting another.",
          409,
        );
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${saved.vehicleId} FOR UPDATE`;
      const vehicle = await tx.vehicle.findUnique({ where: { id: saved.vehicleId } });
      if (!vehicle?.isActive)
        throw new AccountError("Delivery vehicle is unavailable.", 409);
      const load = loadForItems(
        saved.lines.map((l) => ({
          quantity: l.quantity,
          units: l.spaceUnits,
          kind: l.loadKind,
        })),
      );
      let serviceDate: string | null = null;
      for (const date of saved.dates) {
        let used = emptyLoad();
        const reserved = await tx.checkoutAttempt.findMany({
          where: {
            vehicleId: vehicle.id,
            serviceDate: date,
            state: { in: capacityStates },
          },
        });
        for (const r of reserved)
          used = addLoad(used, {
            stops: 1,
            units: r.spaceUnits,
            detergent: r.detergentBuckets,
            scentBeads: r.scentBeadBuckets,
          });
        // Include legacy routes exactly once; new checkout orders are already counted above.
        const routes = await tx.route.findMany({
          where: {
            vehicleId: vehicle.id,
            serviceDate: new Date(date),
            status: { not: "CANCELLED" },
          },
          include: {
            stops: {
              include: {
                order: {
                  include: {
                    checkoutAttempt: true,
                    items: {
                      include: { productVariant: { include: { product: true } } },
                    },
                  },
                },
              },
            },
          },
        });
        if (routes.some((r) => r.status === "IN_PROGRESS" || r.status === "COMPLETED"))
          continue;
        for (const route of routes)
          for (const stop of route.stops) {
            if (stop.order?.checkoutAttempt) continue;
            if (!stop.order || !stop.order.items.length) {
              used.stops = vehicle.capacityStops + 1;
              continue;
            }
            used = addLoad(
              used,
              loadForItems(
                stop.order.items.map((i) => ({
                  quantity: i.quantity,
                  units:
                    i.productVariant.deliveryCapacityUnits ??
                    i.productVariant.product.deliveryCapacityUnits,
                  kind: i.productVariant.product.loadKind,
                })),
              ),
            );
          }
        if (
          fitsVehicle(
            {
              capacityStops: vehicle.capacityStops,
              capacityUnits: vehicle.capacityUnits,
              detergentBucketLimit: vehicle.detergentBucketLimit,
              scentBeadBucketLimit: vehicle.scentBeadBucketLimit,
            },
            addLoad(used, load),
          )
        ) {
          serviceDate = date;
          break;
        }
      }
      if (!serviceDate)
        throw new AccountError(
          "This delivery window is full. No payment was started.",
          409,
        );
      const order = await tx.order.create({
        data: {
          number: `DD-${a.id.toUpperCase()}`,
          customerId: customer.id,
          addressId: saved.address.id,
          status: "PENDING_PAYMENT",
          subtotalCents: saved.subtotalCents,
          discountCents: saved.promotionCents + saved.rewardsCents,
          taxCents: saved.taxCents,
          totalCents: saved.totalCents,
          createdByUserId: userId,
          items: {
            create: saved.lines.map((l) => ({
              productVariantId: l.variantId,
              nameSnapshot: l.name,
              skuSnapshot: l.sku,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
              discountCents: l.discountCents,
              lineTotalCents: l.netCents,
            })),
          },
          taxCalculation: {
            create: {
              provider: "STRIPE_QUOTE",
              destinationJson: json(saved.address),
              taxableCents:
                saved.subtotalCents - saved.promotionCents - saved.rewardsCents,
              taxCents: saved.taxCents,
              externalId: saved.taxCalculationId,
              breakdownJson: json(saved.taxBreakdown),
            },
          },
        },
      });
      for (const line of saved.lines) {
        await persistInventoryTransaction(tx, {
          productVariantId: line.variantId,
          type: "CUSTOMER_RESERVATION",
          quantity: line.quantity,
          referenceType: "CheckoutAttempt",
          referenceId: a.id,
          createdByUserId: userId,
        });
        let quantity = line.quantity;
        const layers = await tx.inventoryCostLayer.findMany({
          where: { productVariantId: line.variantId, quantityRemaining: { gt: 0 } },
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        });
        for (const layer of layers) {
          const holds = await tx.checkoutCostAllocation.aggregate({
            where: { costLayerId: layer.id, state: "HELD" },
            _sum: { quantity: true },
          });
          const take = Math.min(
            quantity,
            layer.quantityRemaining - (holds._sum.quantity ?? 0),
          );
          if (take > 0) {
            await tx.checkoutCostAllocation.create({
              data: {
                checkoutId: a.id,
                costLayerId: layer.id,
                quantity: take,
                unitCostCents: layer.landedUnitCostCents,
              },
            });
            quantity -= take;
          }
          if (!quantity) break;
        }
        if (quantity)
          throw new AccountError(
            "Inventory cost records need review before this item can be sold.",
            409,
          );
      }
      if (saved.rewardsCents)
        await tx.rewardReservation.create({
          data: {
            orderId: order.id,
            customerId: customer.id,
            requestKey: a.requestKey,
            amountCents: saved.rewardsCents,
            // This ledger field is the amount due before applying the held credit.
            orderTotalCents: saved.totalCents + saved.rewardsCents,
          },
        });
      const updated = await tx.checkoutAttempt.update({
        where: { id },
        data: {
          state: "PREPARING",
          orderId: order.id,
          sessionExpiresAt: new Date(Date.now() + 45 * 60000),
          vehicleId: vehicle.id,
          zoneId: saved.zoneId,
          serviceDate,
          spaceUnits: load.units,
          detergentBuckets: load.detergent,
          scentBeadBuckets: load.scentBeads,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "checkout.reserved",
          entityType: "CheckoutAttempt",
          entityId: a.id,
          afterJson: {
            orderId: order.id,
            serviceDate,
            acceptedWindow: true,
            launchDate: saved.launchDate,
            firstDeliveryBy: saved.firstDeliveryBy,
            ...load,
          },
        },
      });
      return updated;
    },
    { timeout: 15000, maxWait: 10000 },
  );
}
