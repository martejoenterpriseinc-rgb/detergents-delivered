import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { financeAccess } from "./finance";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import { costPiece, recordedCost } from "@/lib/domain/quickbooks-cost";
import { integrationEnvironment } from "@/lib/integration-environment";
import { z } from "zod";
export async function recordedOrderCost(
  tx: Prisma.TransactionClient,
  orderId: string,
  returnId?: string,
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      checkoutAttempt: {
        include: {
          costs: {
            include: { costLayer: { select: { productVariantId: true } } },
            take: 501,
          },
        },
      },
      payments: { include: { events: true } },
      stockReturns: { include: { lines: { take: 501 } }, take: 501 },
    },
  });
  const mode = integrationEnvironment();
  const checkout = order?.checkoutAttempt;
  if (
    !mode ||
    !order ||
    !order.placedAt ||
    order.currency !== "USD" ||
    !checkout ||
    checkout.state !== "PAID" ||
    checkout.livemode !== (mode === "live") ||
    !order.items.length ||
    order.items.length > 100 ||
    checkout.costs.length > 500 ||
    order.stockReturns.length > 500 ||
    order.stockReturns.reduce((sum, r) => sum + r.lines.length, 0) > 500 ||
    !order.payments.some(
      (p) =>
        p.provider === "STRIPE" &&
        ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status) &&
        p.amountCents === order.totalCents &&
        p.currency === "USD" &&
        p.events.some(
          (e) =>
            e.verifiedAt &&
            e.externalId === `checkout:${checkout.id}:paid` &&
            ["checkout.session.completed", "checkout.session.reconciled"].includes(
              e.type,
            ),
        ),
    )
  )
    throw new AccountError(
      "A verified paid order with complete original cost evidence is required.",
      409,
    );
  const pieces = checkout.costs.map((c) => ({
    allocationId: c.id,
    costLayerId: c.costLayerId,
    quantity: c.quantity,
    unitCostCents: c.unitCostCents,
  }));
  if (
    checkout.costs.some((c) => c.state !== "CONSUMED") ||
    new Set(order.items.map((i) => i.productVariantId)).size !== order.items.length ||
    checkout.costs.some(
      (c) =>
        !order.items.some((i) => i.productVariantId === c.costLayer.productVariantId),
    ) ||
    order.items.some(
      (i) =>
        checkout.costs
          .filter((c) => c.costLayer.productVariantId === i.productVariantId)
          .reduce((sum, c) => sum + c.quantity, 0) !== i.quantity,
    )
  )
    throw new AccountError("Original FIFO cost allocations are incomplete.", 409);
  recordedCost(pieces);
  if (!returnId)
    return {
      kind: "SALE" as const,
      orderId: order.id,
      number: order.number,
      sourceId: order.id,
      date: businessDate(order.placedAt),
      currency: "USD" as const,
      amountCents: recordedCost(pieces),
      pieces: pieces.sort((a, b) => a.allocationId.localeCompare(b.allocationId)),
    };
  const returned = order.stockReturns.find((r) => r.id === returnId);
  if (!returned) throw new AccountError("Stock return not found on this order.", 404);
  const returnedQuantities = new Map<string, number>();
  for (const receipt of order.stockReturns) {
    for (const line of receipt.lines) {
      const item = order.items.find((i) => i.id === line.orderItemId);
      if (!item) throw new AccountError("Return source is incomplete.", 409);
      const evidence = z.array(costPiece).min(1).max(500).parse(line.costEvidence);
      if (evidence.reduce((sum, c) => sum + c.quantity, 0) !== line.quantity)
        throw new AccountError("Return cost quantities do not match.", 409);
      for (const piece of evidence) {
        const original = checkout.costs.find((c) => c.id === piece.allocationId);
        if (
          !original ||
          original.costLayer.productVariantId !== item.productVariantId ||
          original.costLayerId !== piece.costLayerId ||
          original.unitCostCents !== piece.unitCostCents
        )
          throw new AccountError("Return cost differs from its original sale.", 409);
        const quantity =
          (returnedQuantities.get(piece.allocationId) ?? 0) + piece.quantity;
        if (quantity > original.quantity)
          throw new AccountError(
            "Recorded returns exceed the original cost allocation.",
            409,
          );
        returnedQuantities.set(piece.allocationId, quantity);
      }
    }
  }
  const restored = returned.lines
    .filter((l) => l.condition === "SELLABLE")
    .flatMap((l) => z.array(costPiece).parse(l.costEvidence));
  return {
    kind: "RETURN" as const,
    orderId: order.id,
    number: order.number,
    sourceId: returned.id,
    date: businessDate(returned.receivedAt),
    currency: "USD" as const,
    amountCents: restored.length ? recordedCost(restored) : 0,
    pieces: restored.sort((a, b) => a.allocationId.localeCompare(b.allocationId)),
  };
}
export async function reviewOrderCost(actor: string, raw: unknown) {
  const input = z
    .object({
      orderId: z.string().min(1).max(100),
      returnId: z.string().min(1).max(100).optional(),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await financeAccess(tx, actor);
      return recordedOrderCost(tx, input.orderId, input.returnId);
    },
    { isolationLevel: "RepeatableRead" },
  );
}
export async function costOrderChoices(actor: string, cursor?: string) {
  await financeAccess(prisma, actor);
  z.string().min(1).max(100).optional().parse(cursor);
  const mode = integrationEnvironment();
  if (!mode) throw new AccountError("Accounting environment is unavailable.", 503);
  const rows = await prisma.order.findMany({
    where: {
      checkoutAttempt: { state: "PAID", livemode: mode === "live" },
      currency: "USD",
      placedAt: { not: null },
    },
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      number: true,
      placedAt: true,
      stockReturns: {
        take: 101,
        orderBy: { receivedAt: "desc" },
        select: { id: true, receivedAt: true },
      },
    },
  });
  return {
    nextCursor: rows.length > 50 ? rows[49].id : null,
    rows: rows.slice(0, 50).map((o) => ({
      id: o.id,
      number: o.number,
      date: o.placedAt?.toISOString() ?? null,
      returns: o.stockReturns
        .slice(0, 100)
        .map((r) => ({ id: r.id, date: r.receivedAt.toISOString() })),
      moreReturns: o.stockReturns.length > 100,
    })),
  };
}
