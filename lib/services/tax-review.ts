import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { financeAccess } from "./finance";
import { financeFilters, financeDayStart } from "@/lib/domain/finance";
import { AccountError } from "@/lib/domain/account";

/** Recorded sale tax and signed refund allocations, not a tax filing determination. */
export async function readTaxReview(userId: string, raw: unknown) {
  const filter = financeFilters(raw);
  const end = new Date(new Date(filter.to + "T00:00:00Z").getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
  const dates = { gte: financeDayStart(filter.from), lt: financeDayStart(end) };
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await financeAccess(tx, userId);
      const [orders, adjustments] = await Promise.all([
        tx.order.findMany({
          where: {
            currency: "USD",
            checkoutAttempt: { state: "PAID" },
            OR: [{ placedAt: dates }, { placedAt: null, createdAt: dates }],
          },
          include: {
            checkoutAttempt: { select: { id: true } },
            items: { select: { taxCents: true } },
            payments: { include: { events: true } },
          },
          take: 5001,
        }),
        tx.refundAdjustment.findMany({
          where: { currency: "USD", createdAt: dates, kind: { not: "REWARD_ONLY" } },
          include: {
            request: { select: { orderId: true, order: { select: { number: true } } } },
          },
          take: 5001,
        }),
      ]);
      if (orders.length > 5000 || adjustments.length > 5000)
        throw new AccountError(
          "Narrow the dates to review at most 5,000 records per source.",
          422,
        );
      const trusted = orders.filter(
        (o) =>
          o.items.reduce((n, i) => n + i.taxCents, 0) === o.taxCents &&
          o.payments.some(
            (p) =>
              p.provider === "STRIPE" &&
              ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status) &&
              p.amountCents === o.totalCents &&
              p.currency === o.currency &&
              p.events.some(
                (e) =>
                  e.verifiedAt &&
                  e.externalId === `checkout:${o.checkoutAttempt!.id}:paid` &&
                  ["checkout.session.completed", "checkout.session.reconciled"].includes(
                    e.type,
                  ),
              ),
          ),
      );
      const rows = [
        ...trusted.map((o) => ({
          id: o.id,
          orderId: o.id,
          number: o.number,
          date: (o.placedAt ?? o.createdAt).toISOString(),
          kind: "SALE",
          taxCents: o.taxCents,
          evidence: "Saved paid order",
        })),
        ...adjustments.map((a) => ({
          id: a.id,
          orderId: a.request.orderId,
          number: a.request.order.number,
          date: a.createdAt.toISOString(),
          kind: a.kind,
          taxCents: a.taxCents,
          evidence: "Provider tax matching pending",
        })),
      ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
      return {
        filter,
        saleTaxCents: trusted.reduce((n, o) => n + o.taxCents, 0),
        refundTaxCents: adjustments.reduce((n, a) => n + a.taxCents, 0),
        unverifiedAdjustments: adjustments.filter(
          (a) => a.taxEvidenceStatus !== "VERIFIED",
        ).length,
        excludedOrders: orders.length - trusted.length,
        count: rows.length,
        rows: rows.slice((filter.page - 1) * 50, filter.page * 50),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
