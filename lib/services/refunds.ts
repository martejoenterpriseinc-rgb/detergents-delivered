import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { hasPermission, permissionsForRoles } from "@/lib/domain/authz";
import {
  allocateRefundLine,
  assertRefundCapacity,
  refundRequestInput,
  stockReturnInput,
  cancelRefundInput,
} from "@/lib/domain/refund-allocation";
import { canonicalJson } from "@/lib/commerce/domain";
import { readCommerce } from "@/lib/commerce/runtime";
import { accountIdentity } from "@/lib/services/customer-account";
import { persistInventoryTransaction } from "@/lib/services/inventory-ledger";

type Tx = Prisma.TransactionClient;
const reservedRefundStates = [
  "PREPARED",
  "SUBMITTING",
  "UNKNOWN",
  "PENDING",
  "REQUIRES_ACTION",
  "SUCCEEDED",
] as const;

async function refundAccess(tx: Tx, userId: string) {
  const user = await accountIdentity(tx, userId);
  const permissions = permissionsForRoles(user.userRoles.map(({ role }) => role.code));
  if (!hasPermission(permissions, "orders.write"))
    throw new AccountError("Order management access required.", 403);
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function publicRefundRequest(request: {
  id: string;
  orderId: string;
  paymentId: string;
  amountCents: number;
  currency: string;
  reason: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: request.id,
    orderId: request.orderId,
    paymentId: request.paymentId,
    amountCents: request.amountCents,
    currency: request.currency,
    reason: request.reason,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
  };
}

/**
 * Persist and reserve an exact refund request before any provider call. This boundary
 * intentionally performs no network request while locks are held.
 */
export async function prepareRefund(userId: string, raw: unknown) {
  const input = refundRequestInput.parse(raw);
  input.lines.sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  const requestHash = fingerprint(input);
  await refundAccess(prisma, userId);
  const commerce = await readCommerce(true);
  return prisma.$transaction(
    async (tx) => {
      await refundAccess(tx, userId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"refund:" + input.requestKey}, 0))`;
      const prior = await tx.refundRequest.findUnique({
        where: { requestKey: input.requestKey },
      });
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new AccountError(
            "This request key was already used for another refund.",
            409,
          );
        return publicRefundRequest(prior);
      }
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: {
          items: true,
          payments: { include: { events: true, refunds: true } },
          rewardReservation: true,
          checkoutAttempt: {
            select: { id: true, state: true, stripeAccountId: true, livemode: true },
          },
          refundRequests: { include: { lines: true } },
          refunds: true,
        },
      });
      if (!order) throw new AccountError("Order not found.", 404);
      if (
        !["PAID", "FULFILLING", "OUT_FOR_DELIVERY", "DELIVERED", "REFUNDED"].includes(
          order.status,
        )
      )
        throw new AccountError("Only a verified paid order can be refunded.", 409);
      if (
        !order.checkoutAttempt ||
        order.checkoutAttempt.state !== "PAID" ||
        order.checkoutAttempt.stripeAccountId !== commerce.accountId ||
        order.checkoutAttempt.livemode !== commerce.live
      )
        throw new AccountError("The payment environment does not match this order.", 409);
      if (order.refunds.some((refund) => !refund.requestId))
        throw new AccountError(
          "This order has a legacy refund that requires reconciliation.",
          409,
        );
      const payment = order.payments.find(
        (candidate) => candidate.id === input.paymentId,
      );
      if (
        !payment ||
        payment.provider !== "STRIPE" ||
        !["CAPTURED", "PARTIALLY_REFUNDED"].includes(payment.status) ||
        payment.amountCents !== order.totalCents ||
        payment.currency !== order.currency ||
        !payment.externalId?.startsWith("pi_") ||
        !payment.events.some(
          (event) =>
            event.verifiedAt &&
            ["checkout.session.completed", "checkout.session.reconciled"].includes(
              event.type,
            ) &&
            event.externalId === `checkout:${order.checkoutAttempt!.id}:paid`,
        )
      )
        throw new AccountError("Verified Stripe payment evidence is required.", 409);

      const requestedIds = new Set(input.lines.map((line) => line.orderItemId));
      if (
        requestedIds.size !== input.lines.length ||
        input.lines.some(
          (line) => !order.items.some((item) => item.id === line.orderItemId),
        )
      )
        throw new AccountError("A refund item does not belong to this order.", 409);
      const active = order.refundRequests.filter((request) =>
        reservedRefundStates.includes(
          request.status as (typeof reservedRefundStates)[number],
        ),
      );
      if (order.rewardReservation?.amountCents)
        throw new AccountError(
          "Reward-funded orders require reward refund reconciliation before preparation.",
          409,
        );
      let amountCents = 0;
      const lines = input.lines.map((line) => {
        const itemIndex = order.items.findIndex((item) => item.id === line.orderItemId);
        const item = order.items[itemIndex];
        const alreadyRefunded = active
          .flatMap((request) => request.lines)
          .filter((saved) => saved.orderItemId === item.id)
          .reduce((sum, saved) => sum + saved.quantity, 0);
        if (alreadyRefunded + line.quantity > item.quantity)
          throw new AccountError(
            "Refund quantity exceeds the remaining purchased quantity.",
            409,
          );
        const allocated = allocateRefundLine({
          quantities: {
            purchased: item.quantity,
            alreadyRefunded,
            requested: line.quantity,
          },
          netCents: item.lineTotalCents - item.taxCents,
          taxCents: item.taxCents,
          rewardCents: 0,
        });
        amountCents += allocated.cashCents;
        return {
          orderItemId: item.id,
          quantity: line.quantity,
          netCents: allocated.netCents,
          taxCents: allocated.taxCents,
          rewardCents: allocated.rewardCents,
        };
      });
      if (!amountCents)
        throw new AccountError("This selection has no refundable payment amount.", 409);
      const settledCents = payment.refunds.reduce(
        (sum, refund) => sum + refund.amountCents,
        0,
      );
      const unresolvedCents = active
        .filter(
          (request) => request.paymentId === payment.id && request.status !== "SUCCEEDED",
        )
        .reduce((sum, request) => sum + request.amountCents, 0);
      try {
        assertRefundCapacity({
          capturedCents: payment.amountCents,
          settledCents,
          unresolvedCents,
          requestedCents: amountCents,
        });
      } catch {
        throw new AccountError("Refund exceeds the unreserved captured amount.", 409);
      }
      const request = await tx.refundRequest.create({
        data: {
          orderId: order.id,
          paymentId: payment.id,
          actorUserId: userId,
          requestKey: input.requestKey,
          requestHash,
          amountCents,
          currency: payment.currency,
          reason: input.reason,
          providerAccountId: commerce.accountId,
          livemode: commerce.live,
          lines: { create: lines },
          events: { create: { type: "refund.prepared", status: "PREPARED" } },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "refund.prepared",
          entityType: "RefundRequest",
          entityId: request.id,
          afterJson: {
            orderId: order.id,
            paymentId: payment.id,
            amountCents,
            currency: payment.currency,
          },
        },
      });
      return publicRefundRequest(request);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

/** Release only a draft that has never reached the provider submission boundary. */
export async function cancelPreparedRefund(userId: string, raw: unknown) {
  const input = cancelRefundInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    await refundAccess(tx, userId);
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const request = await tx.refundRequest.findUnique({ where: { id: input.requestId } });
    if (!request || request.orderId !== input.orderId)
      throw new AccountError("Refund request not found.", 404);
    if (
      request.submittedAt ||
      request.providerRefundId ||
      !["PREPARED", "CANCELED"].includes(request.status)
    )
      throw new AccountError(
        "A submitted refund requires provider reconciliation and cannot be canceled here.",
        409,
      );
    if (request.status === "CANCELED") return publicRefundRequest(request);
    const saved = await tx.refundRequest.update({
      where: { id: request.id },
      data: { status: "CANCELED", lastError: null },
    });
    await tx.refundRequestEvent.create({
      data: {
        refundRequestId: request.id,
        type: "refund.draft.canceled",
        status: "CANCELED",
        evidenceJson: { actorUserId: userId, reason: input.reason },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "refund.draft.canceled",
        entityType: "RefundRequest",
        entityId: request.id,
        beforeJson: { status: "PREPARED" },
        afterJson: { status: "CANCELED", reason: input.reason },
      },
    });
    return publicRefundRequest(saved);
  });
}

/** Record goods physically received. This never initiates or implies a payment refund. */
export async function recordStockReturn(userId: string, raw: unknown) {
  const input = stockReturnInput.parse(raw);
  input.lines.sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  const requestHash = fingerprint(input);
  return prisma.$transaction(async (tx) => {
    await refundAccess(tx, userId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"stock-return:" + input.requestKey}, 0))`;
    const prior = await tx.stockReturn.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new AccountError(
          "This request key was already used for another return.",
          409,
        );
      return {
        id: prior.id,
        orderId: prior.orderId,
        receivedAt: prior.receivedAt.toISOString(),
      };
    }
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: true,
        stockReturns: { include: { lines: true } },
        checkoutAttempt: {
          include: {
            costs: { where: { state: "CONSUMED" }, include: { costLayer: true } },
          },
        },
      },
    });
    if (!order) throw new AccountError("Order not found.", 404);
    if (
      order.checkoutAttempt?.state !== "PAID" ||
      new Set(order.items.map((item) => item.productVariantId)).size !==
        order.items.length
    )
      throw new AccountError("Original completed checkout evidence is required.", 409);
    if (
      !["PAID", "FULFILLING", "OUT_FOR_DELIVERY", "DELIVERED", "REFUNDED"].includes(
        order.status,
      )
    )
      throw new AccountError("This order has no completed sale to return.", 409);
    const lines = input.lines.map((line) => {
      const item = order.items.find((candidate) => candidate.id === line.orderItemId);
      if (!item)
        throw new AccountError("A returned item does not belong to this order.", 409);
      const returned = order.stockReturns
        .flatMap((saved) => saved.lines)
        .filter((saved) => saved.orderItemId === item.id)
        .reduce((sum, saved) => sum + saved.quantity, 0);
      if (returned + line.quantity > item.quantity)
        throw new AccountError("Return quantity exceeds the purchased quantity.", 409);
      const costs = order
        .checkoutAttempt!.costs.filter(
          (cost) => cost.costLayer.productVariantId === item.productVariantId,
        )
        .sort(
          (a, b) =>
            a.costLayer.receivedAt.getTime() - b.costLayer.receivedAt.getTime() ||
            a.costLayerId.localeCompare(b.costLayerId),
        );
      if (costs.reduce((sum, cost) => sum + cost.quantity, 0) !== item.quantity)
        throw new AccountError("Original FIFO cost evidence is incomplete.", 409);
      let skip = returned;
      let remaining = line.quantity;
      const costEvidence = costs.flatMap((cost) => {
        const available = Math.max(0, cost.quantity - skip);
        skip = Math.max(0, skip - cost.quantity);
        const quantity = Math.min(remaining, available);
        remaining -= quantity;
        return quantity
          ? [
              {
                allocationId: cost.id,
                costLayerId: cost.costLayerId,
                quantity,
                unitCostCents: cost.unitCostCents,
              },
            ]
          : [];
      });
      return { ...line, item, costEvidence };
    });
    const saved = await tx.stockReturn.create({
      data: {
        orderId: order.id,
        actorUserId: userId,
        requestKey: input.requestKey,
        requestHash,
        reason: input.reason,
        receivedAt: new Date(),
        lines: {
          create: lines.map((line) => ({
            orderItemId: line.orderItemId,
            quantity: line.quantity,
            condition: line.condition,
            costEvidence: line.costEvidence,
          })),
        },
      },
    });
    for (const line of [...lines].sort((a, b) =>
      a.item.productVariantId.localeCompare(b.item.productVariantId),
    )) {
      await persistInventoryTransaction(tx, {
        productVariantId: line.item.productVariantId,
        type: line.condition === "SELLABLE" ? "RETURN" : "DAMAGE",
        quantity: line.quantity,
        inboundDamage: line.condition === "DAMAGED",
        referenceType: "StockReturn",
        referenceId: saved.id,
        reason: input.reason,
        createdByUserId: userId,
      });
      if (line.condition === "SELLABLE") {
        for (const cost of line.costEvidence) {
          await tx.inventoryCostLayer.update({
            where: { id: cost.costLayerId },
            data: { quantityRemaining: { increment: cost.quantity } },
          });
        }
      }
    }
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "stock.return.received",
        entityType: "StockReturn",
        entityId: saved.id,
        afterJson: {
          orderId: order.id,
          lines: lines.map((line) => ({
            orderItemId: line.orderItemId,
            quantity: line.quantity,
            condition: line.condition,
          })),
        },
      },
    });
    return {
      id: saved.id,
      orderId: saved.orderId,
      receivedAt: saved.receivedAt.toISOString(),
    };
  });
}
