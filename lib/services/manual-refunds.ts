import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "@/lib/commerce/domain";
import { integrationEnvironment } from "@/lib/integration-environment";
import {
  allocateRemainingRefundLine,
  refundRequestInput,
  refundReservationStates,
} from "@/lib/domain/refund-allocation";
import { financeAccess } from "./finance";
import { recordedSaleSource } from "./sales-refund-source";
import { refundRewardAmounts } from "./refund-rewards";
import { reviewReferralInTransaction } from "./reward-ledger";
import {
  manualRefundReceiptInput,
  manualRefundDigest,
  manualRefundReceiptKey,
  verifiedManualRefundReceipt,
} from "./manual-refund-evidence";
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const fail = (
  message = "Manual refund allocations or original receipt require review.",
) => new AccountError(message, 409);

function activeMode() {
  const mode = integrationEnvironment();
  if (!mode) throw new AccountError("Application environment is unavailable.", 503);
  return mode;
}
export function manualRefundsEnabled() {
  const mode = activeMode();
  return (
    process.env.DD_MANUAL_REFUNDS_ENABLED === "true" &&
    (mode !== "live" || process.env.DD_LIVE_MANUAL_REFUNDS_ACCEPTED === "true")
  );
}
async function source(tx: Prisma.TransactionClient, orderId: string) {
  const sale = await recordedSaleSource(tx, orderId);
  if (!sale.manualSettlementId || !sale.paymentMethod)
    throw fail("A verified cash or Zelle sale is required.");
  const requests = await tx.refundRequest.findMany({
    where: { orderId },
    include: { lines: true },
  });
  const legacy = await tx.refund.count({ where: { orderId, requestId: null } });
  if (
    legacy ||
    requests.some(
      (r) =>
        r.paymentId !== sale.paymentId ||
        r.providerAccountId !== sale.providerAccountId ||
        r.livemode !== sale.livemode ||
        r.currency !== "USD",
    )
  )
    throw fail();
  const active = requests.filter((r) =>
    refundReservationStates.includes(
      r.status as (typeof refundReservationStates)[number],
    ),
  );
  if (active.some((r) => !["PREPARED", "SUCCEEDED"].includes(r.status)))
    throw fail("Resolve the existing uncertain refund before continuing.");
  const rewards = await refundRewardAmounts(tx, orderId);
  if (active.reduce((s, r) => s + r.amountCents, 0) > sale.cashCents) throw fail();
  for (const l of sale.lines) {
    const held = active
      .flatMap((r) => r.lines)
      .filter((v) => v.orderItemId === l.orderItemId);
    if (
      held.reduce((s, v) => s + v.quantity, 0) > l.quantity ||
      held.reduce((s, v) => s + v.netCents, 0) > l.netCents ||
      held.reduce((s, v) => s + v.taxCents, 0) > l.taxCents ||
      held.reduce((s, v) => s + v.rewardCents, 0) > (rewards.get(l.orderItemId) ?? 0)
    )
      throw fail();
  }
  return { sale, requests, active, rewards };
}
export async function prepareManualRefund(actor: string, raw: unknown) {
  const d = refundRequestInput.parse(raw);
  d.lines.sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  await financeAccess(prisma, actor, true);
  if (!manualRefundsEnabled())
    throw new AccountError("Manual refund preparation is not activated.", 503);
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"refund:" + d.requestKey}, 0))`;
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${d.orderId} FOR UPDATE`;
    const s = await source(tx, d.orderId);
    if (d.paymentId !== s.sale.paymentId) throw fail();
    const prior = await tx.refundRequest.findUnique({
      where: { requestKey: d.requestKey },
    });
    if (prior) {
      if (
        prior.actorUserId !== actor ||
        prior.requestHash !== manualRefundDigest(d) ||
        prior.orderId !== d.orderId
      )
        throw fail("This request key was used for different refund choices.");
      return { id: prior.id, status: prior.status, amountCents: prior.amountCents };
    }
    const lines = d.lines.map((l) => {
      const original = s.sale.lines.find((v) => v.orderItemId === l.orderItemId);
      if (!original) throw fail("A selected item does not belong to this order.");
      const held = s.active
        .flatMap((r) => r.lines)
        .filter((v) => v.orderItemId === l.orderItemId);
      const quantity = held.reduce((n, v) => n + v.quantity, 0);
      if (quantity + l.quantity > original.quantity)
        throw fail("Refund quantity exceeds the remaining purchased quantity.");
      const a = allocateRemainingRefundLine({
        quantities: {
          purchased: original.quantity,
          alreadyRefunded: quantity,
          requested: l.quantity,
        },
        netCents: original.netCents,
        taxCents: original.taxCents,
        rewardCents: s.rewards.get(l.orderItemId) ?? 0,
        allocated: held.reduce(
          (n, v) => ({
            netCents: n.netCents + v.netCents,
            taxCents: n.taxCents + v.taxCents,
            rewardCents: n.rewardCents + v.rewardCents,
          }),
          { netCents: 0, taxCents: 0, rewardCents: 0 },
        ),
      });
      return {
        ...l,
        netCents: a.netCents,
        taxCents: a.taxCents,
        rewardCents: a.rewardCents,
      };
    });
    const amountCents = lines.reduce((n, l) => n + l.netCents + l.taxCents, 0);
    if (!amountCents)
      throw fail(
        "This selection has no cash to return. Reward-only refunds require the credit workflow.",
      );
    const r = await tx.refundRequest.create({
      data: {
        orderId: d.orderId,
        paymentId: d.paymentId,
        actorUserId: actor,
        requestKey: d.requestKey,
        requestHash: manualRefundDigest(d),
        amountCents,
        currency: "USD",
        reason: d.reason,
        providerAccountId: s.sale.providerAccountId,
        livemode: s.sale.livemode,
        lines: { create: lines },
        events: { create: { type: "manual-refund.prepared", status: "PREPARED" } },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "RefundRequest",
        entityId: r.id,
        action: "manual-refund.prepared",
        afterJson: json({
          input: d,
          lines,
          amountCents,
          settlementId: s.sale.manualSettlementId,
        }),
      },
    });
    return { id: r.id, status: r.status, amountCents };
  });
}

/** Records money already returned outside the app. Never sends a transfer or calls a provider. */
export async function recordManualRefund(actor: string, raw: unknown) {
  const d = manualRefundReceiptInput.parse(raw);
  await financeAccess(prisma, actor, true);
  activeMode();
  return prisma.$transaction(
    async (tx) => {
      await financeAccess(tx, actor, true);
      const order = await tx.order.findUnique({
        where: { id: d.orderId },
        include: { qualifyingReferral: true },
      });
      if (!order) throw new AccountError("Order not found.", 404);
      const referral = order.qualifyingReferral;
      for (const id of [
        ...new Set([
          order.customerId,
          ...(referral ? [referral.referrerId, referral.refereeId] : []),
        ]),
      ].sort())
        await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${id} FOR UPDATE`;
      if (referral)
        await tx.$queryRaw`SELECT id FROM "Referral" WHERE id=${referral.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${d.orderId} FOR UPDATE`;
      const current = await tx.order.findUniqueOrThrow({
        where: { id: d.orderId },
        include: { qualifyingReferral: true },
      });
      if (
        current.customerId !== order.customerId ||
        current.qualifyingReferral?.id !== referral?.id
      )
        throw fail("Order changed. Refresh before recording the receipt.");
      const s = await source(tx, d.orderId),
        r = s.requests.find((v) => v.id === d.requestId);
      if (!r) throw new AccountError("Manual refund request not found.", 404);
      if (r.status === "SUCCEEDED") {
        const e = await verifiedManualRefundReceipt(tx, r.id);
        if (e.receiptHash !== manualRefundDigest(d))
          throw fail(
            "A different returned-money receipt is already recorded. Do not return the money again.",
          );
        return { id: r.id, status: r.status, amountCents: r.amountCents };
      }
      if (
        r.status !== "PREPARED" ||
        r.submittedAt ||
        r.providerRefundId ||
        d.method !== s.sale.paymentMethod ||
        d.amountCents !== r.amountCents
      )
        throw fail();
      const original = refundRequestInput.parse({
        requestKey: r.requestKey,
        orderId: r.orderId,
        paymentId: r.paymentId,
        reason: r.reason,
        lines: r.lines
          .map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity }))
          .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
      });
      const lines = r.lines
        .map((l) => ({
          orderItemId: l.orderItemId,
          quantity: l.quantity,
          netCents: l.netCents,
          taxCents: l.taxCents,
          rewardCents: l.rewardCents,
        }))
        .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
      const audits = await tx.auditLog.findMany({
        where: {
          entityType: "RefundRequest",
          entityId: r.id,
          action: "manual-refund.prepared",
        },
        take: 2,
      });
      if (
        manualRefundDigest(original) !== r.requestHash ||
        audits.length !== 1 ||
        audits[0].actorUserId !== r.actorUserId ||
        canonicalJson(audits[0].afterJson) !==
          canonicalJson({
            input: original,
            lines,
            amountCents: r.amountCents,
            settlementId: s.sale.manualSettlementId,
          })
      )
        throw fail();
      const receipt = await tx.manualCheckoutSettlement.findUniqueOrThrow({
        where: { id: s.sale.manualSettlementId! },
      });
      const returnedAt = new Date(d.returnedAt),
        now = new Date();
      if (returnedAt < receipt.receivedAt || returnedAt > now)
        throw fail("Return time must be between original receipt and now.");
      const key = manualRefundReceiptKey(
        r.providerAccountId,
        r.livemode,
        d.method,
        d.reference,
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      if (await tx.refundRequestEvent.findUnique({ where: { providerEventId: key } }))
        throw fail("This return receipt reference has already been recorded.");
      const netCents = lines.reduce((n, l) => n + l.netCents, 0),
        taxCents = lines.reduce((n, l) => n + l.taxCents, 0),
        rewardCents = lines.reduce((n, l) => n + l.rewardCents, 0);
      if (netCents + taxCents !== r.amountCents) throw fail();
      const evidence = {
        ...d,
        actorUserId: actor,
        settlementId: receipt.id,
        accountId: r.providerAccountId,
        livemode: r.livemode,
        requestHash: r.requestHash,
        receiptHash: manualRefundDigest(d),
      };
      await tx.refundRequestEvent.create({
        data: {
          refundRequestId: r.id,
          providerEventId: key,
          type: "manual-refund.returned",
          status: "SUCCEEDED",
          verifiedAt: now,
          evidenceJson: json(evidence),
        },
      });
      await tx.refundAdjustment.create({
        data: {
          requestId: r.id,
          kind: "SETTLEMENT",
          cashCents: r.amountCents,
          netCents,
          taxCents,
          rewardCents,
          currency: "USD",
          taxEvidenceStatus: "UNVERIFIED",
          createdAt: returnedAt,
        },
      });
      await tx.refund.create({
        data: {
          requestId: r.id,
          orderId: r.orderId,
          paymentId: r.paymentId,
          amountCents: r.amountCents,
          currency: "USD",
          reason: r.reason,
          externalId: key,
          createdAt: returnedAt,
        },
      });
      if (rewardCents)
        await tx.rewardEntry.create({
          data: {
            customerId: order.customerId,
            orderId: r.orderId,
            sourceId: r.id,
            kind: "RESTORE",
            amountCents: rewardCents,
            entryKey: `refund:${r.id}:restore`,
            description: "Reward credit restored for manually refunded merchandise",
          },
        });
      await tx.refundRequest.update({
        where: { id: r.id },
        data: {
          status: "SUCCEEDED",
          submittedAt: now,
          reconciledAt: now,
          lastError: null,
        },
      });
      const total =
        s.requests
          .filter((v) => v.status === "SUCCEEDED")
          .reduce((n, v) => n + v.amountCents, 0) + r.amountCents;
      if (total > s.sale.cashCents) throw fail();
      await tx.payment.update({
        where: { id: r.paymentId },
        data: { status: total === s.sale.cashCents ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
      if (referral) await reviewReferralInTransaction(tx, actor, referral.id);
      await tx.auditLog.create({
        data: {
          actorUserId: actor,
          entityType: "RefundRequest",
          entityId: r.id,
          action: "manual-refund.returned",
          afterJson: json(evidence),
        },
      });
      return { id: r.id, status: "SUCCEEDED", amountCents: r.amountCents };
    },
    { timeout: 20000, maxWait: 10000 },
  );
}

export async function readManualRefunds(actor: string, orderId: string) {
  z.string().min(1).max(100).parse(orderId);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const canWrite = await financeAccess(tx, actor),
        s = await source(tx, orderId);
      return {
        canWrite,
        enabled: manualRefundsEnabled(),
        orderId,
        number: s.sale.number,
        paymentId: s.sale.paymentId,
        method: s.sale.paymentMethod!,
        lines: s.sale.lines.map((l) => ({
          id: l.orderItemId,
          name: l.name,
          remaining:
            l.quantity -
            s.active
              .flatMap((r) => r.lines)
              .filter((v) => v.orderItemId === l.orderItemId)
              .reduce((n, v) => n + v.quantity, 0),
        })),
        requests: s.requests.map((r) => ({
          id: r.id,
          status: r.status,
          amountCents: r.amountCents,
          reason: r.reason,
          taxCents: r.lines.reduce((n, l) => n + l.taxCents, 0),
          rewardCents: r.lines.reduce((n, l) => n + l.rewardCents, 0),
        })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
