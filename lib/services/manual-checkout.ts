import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import { canonicalJson, type CheckoutSnapshot } from "@/lib/commerce/domain";
import { checkoutLock, reserveCheckout } from "@/lib/commerce/reservations";
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
      a.state !== "PREPARING" ||
      a.stripeAccountId !== config.accountId ||
      a.livemode !== config.live
    )
      throw new AccountError("This checkout cannot accept a manual receipt.", 409);
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${a.orderId} FOR UPDATE`;
    const snapshot = a.snapshot as unknown as CheckoutSnapshot;
    if (
      d.amountCents !== snapshot.totalCents ||
      receivedAt > a.sessionExpiresAt! ||
      receivedAt < a.createdAt ||
      receivedAt > new Date() ||
      !a.sessionExpiresAt ||
      a.sessionExpiresAt < new Date()
    )
      throw new AccountError("Receipt amount or reservation time needs review.", 409);
    const approval = await assertManualPaymentApproval(
      tx,
      a.customerId,
      a.paymentMethod as "CASH" | "ZELLE",
      d.amountCents,
    );
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
      data: { state: "PROCESSING", lastError: "MANUAL_TAX_PENDING" },
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
        }),
      },
    });
    return { id, state: "RECEIVED" };
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
      data: { state: "UNKNOWN", lastError: "TAX_OR_DELIVERY_RECONCILIATION_REQUIRED" },
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
  const c = await readCommerce(true);
  const rows = await prisma.checkoutAttempt.findMany({
    where: {
      paymentMethod: { in: ["CASH", "ZELLE"] },
      stripeAccountId: c.accountId,
      livemode: c.live,
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
