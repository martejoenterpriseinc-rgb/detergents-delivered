import { integrationEnvironment } from "@/lib/integration-environment";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import { canonicalJson, type CheckoutSnapshot } from "@/lib/commerce/domain";
import {
  checkoutLock,
  reserveCheckout,
  reserveDeliveryDate,
} from "@/lib/commerce/reservations";
import { launchConfig } from "./launch";
import {
  cadenceDates,
  deliveryBookingWindow,
  zonePostalCodes,
} from "@/lib/domain/launch";
import { confirmManualTax } from "@/lib/commerce/manual-tax";
import { finalizeReservedCheckout } from "@/lib/commerce/finalize-checkout";
import { json } from "@/lib/commerce/quote";
import { readCommerce } from "@/lib/commerce/runtime";
import { financeAccess } from "./finance";
import { assertManualPaymentApproval } from "./manual-payment-approvals";
import { customerIdentity } from "./customer-account";
import { persistInventoryTransaction } from "./inventory-ledger";
import { rewardBalance } from "./loyalty";
const idSchema = z.string().min(1).max(100);
export const manualCheckoutInput = z
  .object({
    checkoutId: idSchema,
    method: z.enum(["CASH", "ZELLE"]),
    acceptedWindow: z.literal(true),
  })
  .strict();
const receiptInput = z
  .object({
    checkoutId: idSchema,
    requestKey: z.uuid(),
    amountCents: z.number().int().positive().max(1000000),
    reference: z.string().trim().min(5).max(160),
    reason: z.string().trim().min(5).max(500),
    receivedAt: z.iso.datetime(),
    confirmed: z.literal(true),
  })
  .strict();
export async function beginManualCheckout(actor: string, raw: unknown) {
  const d = manualCheckoutInput.parse(raw);
  const a = await reserveCheckout(actor, d.checkoutId, d.acceptedWindow, d.method);
  return {
    checkoutId: a.id,
    orderId: a.orderId,
    state: a.state,
    method: a.paymentMethod,
  };
}
export async function recordManualReceipt(actor: string, raw: unknown) {
  const d = receiptInput.parse(raw),
    receivedAt = new Date(d.receivedAt);
  await financeAccess(prisma, actor, true);
  const config = await readCommerce(true);
  const hash = createHash("sha256").update(canonicalJson(d)).digest("hex");
  const id =
    "manual_" +
    createHash("sha256")
      .update(actor + ":" + d.requestKey)
      .digest("hex");
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    const original = await tx.checkoutAttempt.findUnique({ where: { id: d.checkoutId } });
    if (!original) throw new AccountError("Checkout not found.", 404);
    await checkoutLock(tx, original.customerId);
    const a = await tx.checkoutAttempt.findUniqueOrThrow({
      where: { id: original.id },
      include: { manualSettlement: true },
    });
    if (a.manualSettlement) {
      if (a.manualSettlement.id !== id || a.manualSettlement.requestHash !== hash)
        throw new AccountError(
          "Received money is already recorded. Reconcile that settlement; do not collect again.",
          409,
        );
      return { id, state: a.manualSettlement.state };
    }
    if (
      !a.orderId ||
      !["CASH", "ZELLE"].includes(a.paymentMethod) ||
      a.stripeSessionId ||
      !["PREPARING", "EXPIRED"].includes(a.state) ||
      a.stripeAccountId !== config.accountId ||
      a.livemode !== config.live
    )
      throw new AccountError("This checkout cannot accept a manual receipt.", 409);
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${a.orderId} FOR UPDATE`;
    const snapshot = a.snapshot as unknown as CheckoutSnapshot;
    if (receivedAt < a.createdAt || receivedAt > new Date())
      throw new AccountError("Receipt amount or reservation time needs review.", 409);
    let review =
      a.state === "EXPIRED" ||
      d.amountCents !== snapshot.totalCents ||
      !a.sessionExpiresAt ||
      receivedAt > a.sessionExpiresAt ||
      a.sessionExpiresAt < new Date();
    const savedApproval = await tx.manualPaymentApproval.findUnique({
      where: { customerId_method: { customerId: a.customerId, method: a.paymentMethod } },
    });
    if (!savedApproval)
      throw new AccountError(
        "Original payment approval is missing. Review the checkout evidence.",
        409,
      );
    const approval = {
      approvalId: savedApproval.id,
      approvalVersion: savedApproval.version,
      method: savedApproval.method,
    };
    try {
      await assertManualPaymentApproval(
        tx,
        a.customerId,
        a.paymentMethod as "CASH" | "ZELLE",
        d.amountCents,
      );
    } catch (error) {
      if (!(error instanceof AccountError) || ![403, 404, 409].includes(error.status))
        throw error;
      review = true;
    }
    const duplicate = await tx.manualCheckoutSettlement.findFirst({
      where: {
        method: a.paymentMethod,
        accountId: a.stripeAccountId,
        livemode: a.livemode,
        reference: d.reference,
      },
    });
    if (duplicate)
      throw new AccountError(
        "This receipt reference already settled another checkout.",
        409,
      );
    await tx.manualCheckoutSettlement.create({
      data: {
        id,
        state: review ? "REVIEW" : "RECEIVED",
        lastError: review ? "RECEIVED_FUNDS_REVIEW" : null,
        checkoutId: a.id,
        method: a.paymentMethod,
        reference: d.reference,
        amountCents: d.amountCents,
        receivedAt,
        actorUserId: actor,
        reason: d.reason,
        approvalId: approval.approvalId,
        approvalVersion: approval.approvalVersion,
        requestHash: hash,
        accountId: a.stripeAccountId,
        livemode: a.livemode,
      },
    });
    await tx.checkoutAttempt.update({
      where: { id: a.id },
      data: {
        state: a.state === "EXPIRED" ? "EXPIRED" : "PROCESSING",
        lastError: review ? "RECEIVED_FUNDS_REVIEW" : "MANUAL_TAX_PENDING",
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "ManualCheckoutSettlement",
        entityId: id,
        action: "manual-payment.received",
        afterJson: json({
          checkoutId: a.id,
          amountCents: d.amountCents,
          reference: d.reference,
          receivedAt: d.receivedAt,
          reason: d.reason,
          ...approval,
          review,
        }),
      },
    });
    return { id, state: review ? "REVIEW" : "RECEIVED" };
  });
}
export async function reconcileManualCheckout(
  actor: string,
  settlementId: string,
  recoveredTaxId?: string,
) {
  idSchema.parse(settlementId);
  z.string()
    .regex(/^tax_[A-Za-z0-9]+$/)
    .optional()
    .parse(recoveredTaxId);
  await financeAccess(prisma, actor, true);
  const receipt = await prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    await tx.$queryRaw`SELECT id FROM "ManualCheckoutSettlement" WHERE id=${settlementId} FOR UPDATE`;
    const r = await tx.manualCheckoutSettlement.findUnique({
      where: { id: settlementId },
      include: { checkout: true },
    });
    if (!r) throw new AccountError("Manual settlement not found.", 404);
    if (r.state === "SETTLED") return r;
    if (r.state === "REVIEW" || r.state === "RETURNED")
      throw new AccountError(
        "Resolve the received-funds review before tax or settlement.",
        409,
      );
    if (r.claimedAt && Date.now() - r.claimedAt.getTime() < 30000)
      throw new AccountError("Settlement is already being checked. Retry shortly.", 409);
    if (r.taxTransactionId && recoveredTaxId && r.taxTransactionId !== recoveredTaxId)
      throw new AccountError("Tax transaction is already bound.", 409);
    const updated = await tx.manualCheckoutSettlement.update({
      where: { id: r.id },
      data: {
        state: "SUBMITTING",
        submittedAt: r.submittedAt ?? new Date(),
        claimedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "ManualCheckoutSettlement",
        entityId: r.id,
        action: "manual-payment.tax.claimed",
        afterJson: { recovery: Boolean(recoveredTaxId || r.taxTransactionId) },
      },
    });
    return { ...updated, checkout: r.checkout };
  });
  if (receipt.state === "SETTLED") return { id: receipt.id, state: "SETTLED" };
  try {
    const evidence = await confirmManualTax(receipt.checkout, receipt, recoveredTaxId);
    // Retain verified provider creation even when delivery/finalization later fails.
    // Otherwise a missed route could discard the provider ID and encourage a new POST.
    await prisma.$transaction(async (tx) => {
      await financeAccess(tx, actor, true);
      await tx.$queryRaw`SELECT id FROM "ManualCheckoutSettlement" WHERE id=${receipt.id} FOR UPDATE`;
      const r = await tx.manualCheckoutSettlement.findUniqueOrThrow({
        where: { id: receipt.id },
      });
      if (
        r.claimedAt?.getTime() !== receipt.claimedAt?.getTime() ||
        (r.taxTransactionId && r.taxTransactionId !== evidence.taxTransactionId)
      )
        throw new AccountError("A newer tax reconciliation is running.", 409);
      await tx.manualCheckoutSettlement.update({
        where: { id: r.id },
        data: {
          taxTransactionId: evidence.taxTransactionId,
          taxEvidence: json(evidence),
        },
      });
      if (!r.taxTransactionId)
        await tx.auditLog.create({
          data: {
            actorUserId: actor,
            entityType: "ManualCheckoutSettlement",
            entityId: r.id,
            action: "manual-payment.tax.verified",
            afterJson: json(evidence),
          },
        });
    });
    return await prisma.$transaction(
      async (tx) => {
        await financeAccess(tx, actor, true);
        await checkoutLock(tx, receipt.checkout.customerId);
        const a = await tx.checkoutAttempt.findUniqueOrThrow({
          where: { id: receipt.checkoutId },
        });
        if (!a.orderId) throw new AccountError("Reserved order is missing.", 409);
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${a.orderId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "ManualCheckoutSettlement" WHERE id=${receipt.id} FOR UPDATE`;
        const r = await tx.manualCheckoutSettlement.findUniqueOrThrow({
          where: { id: receipt.id },
        });
        if (r.state === "SETTLED") return { id: r.id, state: r.state };
        if (r.claimedAt?.getTime() !== receipt.claimedAt?.getTime())
          throw new AccountError("A newer settlement check is running.", 409);
        if (a.state !== "PROCESSING" || a.stripeSessionId || a.paymentMethod !== r.method)
          throw new AccountError("Manual settlement state changed.", 409);
        await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${a.vehicleId} FOR UPDATE`;
        const departed = await tx.route.count({
          where: {
            vehicleId: a.vehicleId,
            serviceDate: new Date(a.serviceDate!),
            status: { in: ["IN_PROGRESS", "COMPLETED"] },
          },
        });
        if (!a.serviceDate || a.serviceDate < businessDate() || departed)
          throw new AccountError(
            "Received payment needs a new delivery reservation before settlement.",
            409,
          );
        const s = a.snapshot as unknown as CheckoutSnapshot;
        const wallet = await rewardBalance(tx, a.customerId);
        if (s.rewardsCents && wallet.balanceCents < wallet.heldCents)
          throw new AccountError("Reserved rewards need review.", 409);
        const record = {
          manualSettlementId: r.id,
          paymentStatus: "paid",
          status: "complete",
          amount: r.amountCents,
          currency: "usd",
          livemode: r.livemode,
          source: "staff-confirmed-manual",
          method: r.method,
          taxTransactionId: evidence.taxTransactionId,
          receivedAt: r.receivedAt.toISOString(),
        };
        await finalizeReservedCheckout(tx, a, s, evidence.taxLines, {
          provider: "MANUAL",
          externalId: r.id,
          eventType: "manual.payment.settled",
          record,
        });
        await tx.manualCheckoutSettlement.update({
          where: { id: r.id },
          data: {
            state: "SETTLED",
            taxTransactionId: evidence.taxTransactionId,
            taxEvidence: json(evidence),
            lastError: null,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor,
            entityType: "ManualCheckoutSettlement",
            entityId: r.id,
            action: "manual-payment.settled",
            afterJson: json(record),
          },
        });
        return { id: r.id, state: "SETTLED" };
      },
      { timeout: 20000, maxWait: 10000 },
    );
  } catch (error) {
    await prisma.manualCheckoutSettlement.updateMany({
      where: { id: receipt.id, state: "SUBMITTING", claimedAt: receipt.claimedAt },
      data: {
        state: "UNKNOWN",
        claimedAt: null,
        lastError: "TAX_OR_DELIVERY_RECONCILIATION_REQUIRED",
      },
    });
    throw error;
  }
}
export async function cancelManualCheckout(actor: string, checkoutId: string) {
  idSchema.parse(checkoutId);
  return prisma.$transaction(async (tx) => {
    const { customer } = await customerIdentity(tx, actor);
    await checkoutLock(tx, customer.id);
    const a = await tx.checkoutAttempt.findFirst({
      where: { id: checkoutId, customerId: customer.id },
      include: { manualSettlement: true },
    });
    if (!a || a.paymentMethod === "STRIPE")
      throw new AccountError("Manual checkout not found.", 404);
    if (a.state === "EXPIRED") return;
    if (a.manualSettlement || a.stripeSessionId || a.state !== "PREPARING" || !a.orderId)
      throw new AccountError(
        "Received or uncertain payments need staff reconciliation before cancellation.",
        409,
      );
    const s = a.snapshot as unknown as CheckoutSnapshot;
    for (const line of s.lines)
      await persistInventoryTransaction(tx, {
        productVariantId: line.variantId,
        type: "RESERVATION_RELEASE",
        quantity: line.quantity,
        referenceType: "CheckoutAttempt",
        referenceId: a.id,
        createdByUserId: actor,
      });
    await tx.rewardReservation.updateMany({
      where: { orderId: a.orderId, state: "HELD" },
      data: { state: "RELEASED" },
    });
    await tx.checkoutCostAllocation.updateMany({
      where: { checkoutId: a.id, state: "HELD" },
      data: { state: "RELEASED" },
    });
    await tx.order.update({ where: { id: a.orderId }, data: { status: "CANCELLED" } });
    await tx.checkoutAttempt.update({
      where: { id: a.id },
      data: { state: "EXPIRED", lastError: null },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "CheckoutAttempt",
        entityId: a.id,
        action: "manual-payment.unpaid.cancelled",
        afterJson: { orderId: a.orderId },
      },
    });
  });
}
export async function manualCheckoutChoices(actor: string, checkoutId: string) {
  if (process.env.DD_MANUAL_PAYMENTS_ENABLED !== "true") return [];
  const { customer } = await customerIdentity(prisma, actor);
  const a = await prisma.checkoutAttempt.findFirst({
    where: { id: checkoutId, customerId: customer.id },
  });
  if (!a || a.state !== "QUOTED") return [];
  const s = a.snapshot as unknown as CheckoutSnapshot;
  const approvals = await prisma.manualPaymentApproval.findMany({
    where: {
      customerId: customer.id,
      enabled: true,
      expiresAt: { gt: new Date() },
      maxOrderCents: { gte: s.totalCents },
    },
  });
  return approvals.map((v) => v.method);
}
export async function readManualCheckouts(actor: string) {
  const canWrite = await financeAccess(prisma, actor);
  const environment = integrationEnvironment();
  if (!environment) throw new AccountError("Payment environment is unavailable.", 503);
  const rows = await prisma.checkoutAttempt.findMany({
    where: {
      paymentMethod: { in: ["CASH", "ZELLE"] },
      livemode: environment === "live",
    },
    include: {
      order: { select: { number: true, totalCents: true } },
      manualSettlement: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return {
    canWrite,
    rows: rows.map((a) => ({
      id: a.id,
      orderId: a.orderId,
      method: a.paymentMethod,
      state: a.state,
      order: a.order?.number ?? "Unreserved",
      amountCents: a.order?.totalCents ?? null,
      expiresAt: a.sessionExpiresAt?.toISOString() ?? null,
      settlement: a.manualSettlement
        ? {
            id: a.manualSettlement.id,
            state: a.manualSettlement.state,
            reference: a.manualSettlement.reference,
            amountCents: a.manualSettlement.amountCents,
            taxTransactionId: a.manualSettlement.taxTransactionId,
            lastError: a.manualSettlement.lastError,
          }
        : null,
    })),
  };
}

const resolutionInput = z
  .object({
    id: idSchema,
    requestKey: z.uuid(),
    reason: z.string().trim().min(5).max(500),
    confirmed: z.literal(true),
    action: z.enum(["APPROVE", "RETURN", "RESCHEDULE"]),
    serviceDate: z.iso.date().optional(),
    reference: z.string().trim().min(5).max(160).optional(),
  })
  .strict();
/** Resolves money already received; never collects a second payment. */
export async function resolveManualSettlement(actor: string, raw: unknown) {
  const d = resolutionInput.parse(raw);
  const config = await readCommerce(true);
  const auditId =
    "manual-resolution_" +
    createHash("sha256")
      .update(actor + ":" + d.requestKey)
      .digest("hex");
  const hash = createHash("sha256").update(canonicalJson(d)).digest("hex");
  return prisma.$transaction(
    async (tx) => {
      await financeAccess(tx, actor, true);
      const first = await tx.manualCheckoutSettlement.findUnique({
        where: { id: d.id },
        include: { checkout: true },
      });
      if (
        !first ||
        first.accountId !== config.accountId ||
        first.livemode !== config.live
      )
        throw new AccountError("Settlement not found in this environment.", 404);
      await checkoutLock(tx, first.checkout.customerId);
      const prior = await tx.auditLog.findUnique({ where: { id: auditId } });
      if (prior) {
        const proof = z
          .object({ hash: z.string(), state: z.string() })
          .parse(prior.afterJson);
        if (proof.hash !== hash)
          throw new AccountError("Resolution request changed.", 409);
        return { id: d.id, state: proof.state };
      }
      await tx.$queryRaw`SELECT id FROM "ManualCheckoutSettlement" WHERE id=${d.id} FOR UPDATE`;
      const r = await tx.manualCheckoutSettlement.findUniqueOrThrow({
        where: { id: d.id },
        include: { checkout: true },
      });
      const a = r.checkout;
      if (
        !a.orderId ||
        a.stripeSessionId ||
        a.paymentMethod !== r.method ||
        !["PROCESSING", "EXPIRED"].includes(a.state) ||
        ["SUBMITTING", "SETTLED", "RETURNED"].includes(r.state)
      )
        throw new AccountError(
          "This settlement cannot be changed by a review action.",
          409,
        );
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${a.orderId} FOR UPDATE`;
      const s = a.snapshot as unknown as CheckoutSnapshot;
      let next = r.state;
      if (d.action === "RETURN") {
        if (!d.reference || r.taxTransactionId || r.submittedAt || r.taxEvidence)
          throw new AccountError(
            "Return requires a bank/cash reference and no pending or created tax transaction. Reconcile tax first.",
            409,
          );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(613279109)`;
        const duplicate = await tx.auditLog.findFirst({
          where: {
            action: "manual-payment.review.RETURN",
            AND: [
              { afterJson: { path: ["returnReference"], equals: d.reference } },
              { afterJson: { path: ["accountId"], equals: r.accountId } },
              { afterJson: { path: ["livemode"], equals: r.livemode } },
            ],
          },
        });
        if (duplicate)
          throw new AccountError("Return reference is already recorded.", 409);
        if (a.state !== "EXPIRED") {
          for (const l of s.lines)
            await persistInventoryTransaction(tx, {
              productVariantId: l.variantId,
              type: "RESERVATION_RELEASE",
              quantity: l.quantity,
              referenceType: "CheckoutAttempt",
              referenceId: a.id,
              createdByUserId: actor,
            });
          await tx.rewardReservation.updateMany({
            where: { orderId: a.orderId, state: "HELD" },
            data: { state: "RELEASED" },
          });
          await tx.checkoutCostAllocation.updateMany({
            where: { checkoutId: a.id, state: "HELD" },
            data: { state: "RELEASED" },
          });
          await tx.order.update({
            where: { id: a.orderId },
            data: { status: "CANCELLED" },
          });
          await tx.checkoutAttempt.update({
            where: { id: a.id },
            data: { state: "EXPIRED", lastError: null },
          });
        }
        next = "RETURNED";
      } else {
        if (a.state === "EXPIRED" || r.amountCents !== s.totalCents)
          throw new AccountError(
            "Released reservations or incorrect amounts must be returned; create a new checkout after return.",
            409,
          );
        if (d.action === "APPROVE") {
          if (r.state !== "REVIEW" || r.submittedAt || r.taxTransactionId)
            throw new AccountError(
              "Only an unsubmitted received-funds review can be approved.",
              409,
            );
          await assertManualPaymentApproval(
            tx,
            a.customerId,
            r.method as "CASH" | "ZELLE",
            r.amountCents,
          );
          next = "RECEIVED";
        } else {
          if (!d.serviceDate)
            throw new AccountError("Choose the agreed delivery date.", 400);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(613279105)`;
          const address = await tx.address.findFirst({
            where: { id: s.address.id, customerId: a.customerId, deletedAt: null },
            include: { deliveryZone: true },
          });
          if (
            !address?.validatedAt ||
            !address.validationSource ||
            !address.deliveryZone?.isActive ||
            address.deliveryZoneId !== a.zoneId ||
            !zonePostalCodes(address.deliveryZone.boundaryJson).includes(
              address.postalCode,
            ) ||
            address.line1 !== s.address.line1 ||
            (address.line2 ?? "") !== s.address.line2 ||
            address.city !== s.address.city ||
            address.region !== s.address.region ||
            address.postalCode !== s.address.postalCode ||
            address.country !== s.address.country
          )
            throw new AccountError(
              "Original delivery address or service area changed. Review before rescheduling.",
              409,
            );
          const launch = await launchConfig(tx),
            window = deliveryBookingWindow(launch, businessDate());
          const cadence = launch.cadences.find(
            (c) => c.locked && c.zoneId === a.zoneId && c.vehicleId === a.vehicleId,
          );
          if (
            !window ||
            !cadence ||
            !cadenceDates(cadence, window.start, window.end).includes(d.serviceDate) ||
            d.serviceDate <= businessDate()
          )
            throw new AccountError(
              "Date is outside this area's available delivery calendar.",
              409,
            );
          const date = await reserveDeliveryDate(
            tx,
            { vehicleId: a.vehicleId! },
            [d.serviceDate],
            {
              stops: 1,
              units: a.spaceUnits,
              detergent: a.detergentBuckets,
              scentBeads: a.scentBeadBuckets,
            },
            a.id,
          );
          await tx.checkoutAttempt.update({
            where: { id: a.id },
            data: { serviceDate: date },
          });
        }
      }
      await tx.manualCheckoutSettlement.update({
        where: { id: r.id },
        data: { state: next, ...(d.action !== "RESCHEDULE" ? { lastError: null } : {}) },
      });
      await tx.auditLog.create({
        data: {
          id: auditId,
          actorUserId: actor,
          entityType: "ManualCheckoutSettlement",
          entityId: r.id,
          action: "manual-payment.review." + d.action,
          beforeJson: json({ state: r.state, serviceDate: a.serviceDate }),
          afterJson: json({
            hash,
            state: next,
            action: d.action,
            reason: d.reason,
            amountCents: r.amountCents,
            method: r.method,
            accountId: r.accountId,
            livemode: r.livemode,
            returnReference: d.reference ?? null,
            serviceDate: d.serviceDate ?? a.serviceDate,
            source: "staff-confirmed-review",
          }),
        },
      });
      return { id: r.id, state: next };
    },
    { timeout: 15000, maxWait: 10000 },
  );
}
