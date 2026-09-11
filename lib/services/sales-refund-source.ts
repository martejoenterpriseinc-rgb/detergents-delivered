import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import { canonicalJson } from "@/lib/commerce/domain";
import { financeAccess } from "./finance";
import { integrationEnvironment } from "@/lib/integration-environment";
const cents = z.number().int().min(0).max(100000000),
  id = z.string().min(1).max(100);
const addressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200),
  city: z.string().min(1).max(100),
  region: z.string().regex(/^[A-Z]{2}$/),
  postalCode: z.string().regex(/^\d{5}(?:-\d{4})?$/),
  country: z.literal("US"),
});
const lineSchema = z.object({
  variantId: id,
  name: z.string(),
  sku: z.string(),
  quantity: z.number().int().min(1).max(100),
  unitPriceCents: cents,
  discountCents: cents,
  netCents: cents,
  taxCode: z.string().min(1),
});
const snapshotSchema = z.object({
  address: addressSchema,
  lines: z.array(lineSchema).min(1).max(30),
  subtotalCents: cents,
  promotionCents: cents,
  rewardsCents: cents,
  taxCents: cents,
  totalCents: cents,
  taxCalculationId: z.string().min(1),
  taxBreakdown: z.unknown(),
});
const fail = () =>
  new AccountError(
    "Original sale and payment evidence is incomplete or inconsistent. Review this order before exporting it.",
    409,
  );
export async function recordedSaleSource(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      taxCalculation: true,
      checkoutAttempt: true,
      payments: { include: { events: true } },
      rewardReservation: true,
    },
  });
  const mode = integrationEnvironment(),
    checkout = order?.checkoutAttempt,
    parsed = snapshotSchema.safeParse(checkout?.snapshot);
  if (
    !order ||
    !order.placedAt ||
    order.currency !== "USD" ||
    order.shippingCents !== 0 ||
    !mode ||
    !checkout ||
    checkout.state !== "PAID" ||
    checkout.livemode !== (mode === "live") ||
    !checkout.stripeSessionId ||
    !parsed.success
  )
    throw fail();
  const s = parsed.data,
    tax = order.taxCalculation;
  if (
    order.items.length !== s.lines.length ||
    new Set(s.lines.map((l) => l.variantId)).size !== s.lines.length ||
    !tax ||
    tax.provider !== "STRIPE_QUOTE" ||
    tax.currency !== "USD" ||
    tax.externalId !== s.taxCalculationId ||
    tax.taxCents !== s.taxCents ||
    tax.taxableCents !== s.subtotalCents - s.promotionCents - s.rewardsCents ||
    canonicalJson(tax.breakdownJson) !== canonicalJson(s.taxBreakdown) ||
    canonicalJson(addressSchema.parse(tax.destinationJson)) !==
      canonicalJson(s.address) ||
    order.subtotalCents !== s.subtotalCents ||
    order.discountCents !== s.promotionCents + s.rewardsCents ||
    order.taxCents !== s.taxCents ||
    order.totalCents !== s.totalCents ||
    s.totalCents !== s.subtotalCents - s.promotionCents - s.rewardsCents + s.taxCents ||
    s.lines.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0) !== s.subtotalCents ||
    s.lines.reduce((n, l) => n + l.discountCents, 0) !== order.discountCents ||
    s.lines.reduce((n, l) => n + l.netCents, 0) !== s.totalCents - s.taxCents
  )
    throw fail();
  const payments = order.payments.filter(
    (p) =>
      p.provider === "STRIPE" &&
      ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status) &&
      p.currency === "USD" &&
      p.amountCents === s.totalCents &&
      p.events.some(
        (e) =>
          e.verifiedAt &&
          e.externalId === `checkout:${checkout.id}:paid` &&
          ["checkout.session.completed", "checkout.session.reconciled"].includes(e.type),
      ),
  );
  if (payments.length !== 1 || !payments[0].externalId) throw fail();
  if (
    s.rewardsCents &&
    (!order.rewardReservation ||
      order.rewardReservation.state !== "USED" ||
      order.rewardReservation.amountCents !== s.rewardsCents)
  )
    throw fail();
  if (s.rewardsCents) {
    const redemption = await tx.rewardEntry.findUnique({
      where: { entryKey: `order:${order.id}:use` },
    });
    if (
      !redemption ||
      redemption.kind !== "REDEMPTION" ||
      redemption.amountCents !== -s.rewardsCents ||
      redemption.orderId !== order.id ||
      redemption.customerId !== order.customerId ||
      redemption.sourceId !== order.rewardReservation!.id
    )
      throw fail();
  }
  const audits = await tx.auditLog.findMany({
    where: {
      entityType: "Order",
      entityId: order.id,
      action: "checkout.payment.finalized",
    },
    take: 2,
  });
  const proof = z
    .object({
      sessionId: z.string(),
      amount: cents,
      currency: z.literal("usd"),
      livemode: z.boolean(),
      paymentStatus: z.literal("paid"),
      status: z.literal("complete"),
      rewardsUsedCents: cents,
      taxLines: z
        .array(z.object({ variantId: id, netCents: cents, taxCents: cents }))
        .min(1)
        .max(30),
    })
    .safeParse(audits[0]?.afterJson);
  if (
    audits.length !== 1 ||
    !proof.success ||
    proof.data.sessionId !== checkout.stripeSessionId ||
    proof.data.amount !== s.totalCents ||
    proof.data.livemode !== checkout.livemode ||
    proof.data.rewardsUsedCents !== s.rewardsCents ||
    proof.data.taxLines.length !== s.lines.length ||
    new Set(proof.data.taxLines.map((l) => l.variantId)).size !== s.lines.length ||
    proof.data.taxLines.reduce((n, l) => n + l.taxCents, 0) !== s.taxCents
  )
    throw fail();
  const lines = s.lines
    .map((l) => {
      const item = order.items.find((i) => i.productVariantId === l.variantId),
        paid = proof.data.taxLines.find((p) => p.variantId === l.variantId);
      if (
        !item ||
        !paid ||
        item.nameSnapshot !== l.name ||
        item.skuSnapshot !== l.sku ||
        item.quantity !== l.quantity ||
        item.unitPriceCents !== l.unitPriceCents ||
        item.discountCents !== l.discountCents ||
        l.unitPriceCents * l.quantity - l.discountCents !== l.netCents ||
        paid.netCents !== l.netCents ||
        item.taxCents !== paid.taxCents ||
        item.lineTotalCents !== l.netCents + paid.taxCents
      )
        throw fail();
      return { orderItemId: item.id, ...l, taxCents: paid.taxCents };
    })
    .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  return {
    kind: "SALE" as const,
    orderId: order.id,
    sourceId: order.id,
    customerId: order.customerId,
    number: order.number,
    date: businessDate(order.placedAt),
    currency: "USD" as const,
    providerAccountId: checkout.stripeAccountId,
    livemode: checkout.livemode,
    paymentId: payments[0].id,
    paymentIntentId: payments[0].externalId,
    sessionId: checkout.stripeSessionId,
    subtotalCents: s.subtotalCents,
    promotionCents: s.promotionCents,
    rewardsCents: s.rewardsCents,
    netCents: s.totalCents - s.taxCents,
    taxCents: s.taxCents,
    cashCents: s.totalCents,
    lines,
    address: s.address,
    taxCalculationId: s.taxCalculationId,
    taxSnapshotHash: createHash("sha256")
      .update(
        canonicalJson({
          calculationId: s.taxCalculationId,
          destination: tax.destinationJson,
          breakdown: tax.breakdownJson,
          paidTaxLines: proof.data.taxLines,
        }),
      )
      .digest("hex"),
  };
}
export async function recordedRefundSource(
  tx: Prisma.TransactionClient,
  orderId: string,
  adjustmentId: string,
) {
  const sale = await recordedSaleSource(tx, orderId),
    a = await tx.refundAdjustment.findUnique({
      where: { id: adjustmentId },
      include: {
        taxEvidence: true,
        request: { include: { lines: true, events: true, adjustments: true } },
      },
    });
  if (!a || a.request.orderId !== orderId)
    throw new AccountError("Refund accounting entry not found on this order.", 404);
  const request = a.request,
    kind = z.enum(["SETTLEMENT", "COMPENSATION", "REWARD_ONLY"]).parse(a.kind),
    sign = kind === "COMPENSATION" ? -1 : 1;
  if (
    request.paymentId !== sale.paymentId ||
    request.providerAccountId !== sale.providerAccountId ||
    request.livemode !== sale.livemode ||
    request.currency !== "USD" ||
    a.currency !== "USD" ||
    !request.lines.length ||
    request.lines.length > 30 ||
    new Set(request.lines.map((l) => l.orderItemId)).size !== request.lines.length ||
    a.cashCents !== sign * request.amountCents ||
    a.netCents + a.taxCents !== a.cashCents ||
    a.netCents !== sign * request.lines.reduce((n, l) => n + l.netCents, 0) ||
    a.taxCents !== sign * request.lines.reduce((n, l) => n + l.taxCents, 0) ||
    a.rewardCents !== sign * request.lines.reduce((n, l) => n + l.rewardCents, 0)
  )
    throw new AccountError("Refund accounting amounts require review.", 409);
  const lines = request.lines
    .map((l) => {
      const original = sale.lines.find((s) => s.orderItemId === l.orderItemId);
      if (
        !original ||
        l.quantity < 1 ||
        l.quantity > original.quantity ||
        l.netCents < 0 ||
        l.netCents > original.netCents ||
        l.taxCents < 0 ||
        l.taxCents > original.taxCents ||
        l.rewardCents < 0
      )
        throw new AccountError("Refund allocations differ from the original sale.", 409);
      return {
        orderItemId: l.orderItemId,
        variantId: original.variantId,
        name: original.name,
        sku: original.sku,
        quantity: l.quantity,
        netCents: sign * l.netCents,
        taxCents: sign * l.taxCents,
        rewardCents: sign * l.rewardCents,
      };
    })
    .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  if (
    kind !== "REWARD_ONLY" &&
    (!a.providerRefundId ||
      a.providerRefundId !== request.providerRefundId ||
      !request.events.some(
        (e) =>
          e.verifiedAt &&
          e.status === (kind === "SETTLEMENT" ? "SUCCEEDED" : request.status),
      ))
  )
    throw new AccountError("Verified refund-provider evidence is required.", 409);
  if (kind === "COMPENSATION") {
    const original = request.adjustments.find((r) => r.kind === "SETTLEMENT");
    if (
      !original ||
      original.cashCents !== -a.cashCents ||
      original.netCents !== -a.netCents ||
      original.taxCents !== -a.taxCents ||
      original.rewardCents !== -a.rewardCents ||
      !a.failureBalanceTransactionId ||
      !["FAILED", "CANCELED"].includes(request.status)
    )
      throw new AccountError("Refund compensation evidence is incomplete.", 409);
  }
  if (
    kind === "REWARD_ONLY" &&
    (a.cashCents !== 0 ||
      a.netCents !== 0 ||
      a.taxCents !== 0 ||
      a.rewardCents <= 0 ||
      a.taxEvidenceStatus !== "NOT_APPLICABLE")
  )
    throw new AccountError("Reward-only accounting evidence is incomplete.", 409);
  if (Math.abs(a.rewardCents) > sale.rewardsCents)
    throw new AccountError(
      "Refund reward allocation exceeds the original redemption.",
      409,
    );
  if (a.rewardCents) {
    const reward = await tx.rewardEntry.findUnique({
      where: {
        entryKey: `refund:${request.id}:${kind === "COMPENSATION" ? "compensate" : "restore"}`,
      },
    });
    if (
      !reward ||
      reward.sourceId !== request.id ||
      reward.orderId !== orderId ||
      reward.customerId !== sale.customerId ||
      reward.amountCents !== a.rewardCents ||
      reward.kind !== (kind === "COMPENSATION" ? "REVERSAL" : "RESTORE")
    )
      throw new AccountError("Refund reward ledger evidence is incomplete.", 409);
  }
  const evidence = a.taxEvidence;
  const matched =
    kind === "SETTLEMENT" &&
    evidence &&
    evidence.providerAccountId === sale.providerAccountId &&
    evidence.livemode === sale.livemode &&
    evidence.currency === "USD" &&
    evidence.taxCents === a.taxCents;
  return {
    kind,
    orderId,
    sourceId: a.id,
    requestId: request.id,
    customerId: sale.customerId,
    number: sale.number,
    date: businessDate(a.createdAt),
    currency: "USD" as const,
    cashCents: a.cashCents,
    netCents: a.netCents,
    taxCents: a.taxCents,
    rewardCents: a.rewardCents,
    lines,
    providerRefundId: a.providerRefundId,
    taxEvidenceStatus:
      kind === "REWARD_ONLY"
        ? ("NOT_APPLICABLE" as const)
        : matched
          ? ("MATCHED" as const)
          : ("UNVERIFIED" as const),
    taxEvidenceId: matched ? evidence.id : null,
    originalTaxTransactionId: matched ? evidence.originalTaxTransactionId : null,
    refundTaxTransactionId: matched ? evidence.refundTaxTransactionId : null,
    requiresCashReceipt: kind !== "REWARD_ONLY" && a.cashCents !== 0,
  };
}
export async function reviewSalesRefundSource(actor: string, raw: unknown) {
  const input = z
    .object({ orderId: id, adjustmentId: id.optional() })
    .strict()
    .parse(raw);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await financeAccess(tx, actor);
      return input.adjustmentId
        ? recordedRefundSource(tx, input.orderId, input.adjustmentId)
        : recordedSaleSource(tx, input.orderId);
    },
    { isolationLevel: "RepeatableRead" },
  );
}
export async function salesRefundChoices(actor: string, cursor?: string) {
  const canWrite = await financeAccess(prisma, actor);
  id.optional().parse(cursor);
  const mode = integrationEnvironment();
  if (!mode) throw new AccountError("Accounting environment is unavailable.", 503);
  const rows = await prisma.order.findMany({
    where: {
      currency: "USD",
      placedAt: { not: null },
      checkoutAttempt: { state: "PAID", livemode: mode === "live" },
    },
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      number: true,
      refundRequests: {
        take: 101,
        orderBy: { createdAt: "desc" },
        select: { adjustments: { select: { id: true, kind: true, createdAt: true } } },
      },
    },
  });
  return {
    canWrite,
    nextCursor: rows.length > 50 ? rows[49].id : null,
    rows: rows.slice(0, 50).map((r) => ({
      id: r.id,
      number: r.number,
      adjustments: r.refundRequests.slice(0, 100).flatMap((r) =>
        r.adjustments.map((a) => ({
          id: a.id,
          kind: a.kind,
          date: a.createdAt.toISOString(),
        })),
      ),
      moreRefunds: r.refundRequests.length > 100,
    })),
  };
}
