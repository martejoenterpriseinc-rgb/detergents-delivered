import { Prisma, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runtimeCommerceConfiguration } from "@/lib/commerce/runtime";
import { paymentPeriod, type paymentCategories } from "@/lib/domain/payment-overview";
export async function readPaymentOverview(
  raw: unknown,
  category?: keyof typeof paymentCategories,
  page = 1,
) {
  const range = paymentPeriod(raw),
    config = await runtimeCommerceConfiguration();
  const scope = {
    livemode: config.live,
    ...(config.accountId ? { stripeAccountId: config.accountId } : {}),
  };
  const dates = { gte: range.start, lt: range.end };
  const base: Prisma.PaymentWhereInput = {
    provider: "STRIPE",
    currency: "USD",
    order: { checkoutAttempt: { is: scope } },
    createdAt: dates,
  };
  const statuses: Record<string, PaymentStatus[]> = {
    succeeded: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"],
    gross: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"],
    uncaptured: ["AUTHORIZED"],
    failed: ["FAILED"],
  };
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const groups = await tx.payment.groupBy({
        by: ["status"],
        where: base,
        _count: true,
        _sum: { amountCents: true },
      });
      const refundsWhere = {
        currency: "USD",
        createdAt: dates,
        request: { order: { checkoutAttempt: { is: scope } } },
      };
      const refund = await tx.refundAdjustment.aggregate({
        where: refundsWhere,
        _sum: { cashCents: true },
        _count: true,
      });
      const reviewWhere = { ...scope, createdAt: dates, state: "REVIEW" };
      const reviewCount = await tx.checkoutAttempt.count({ where: reviewWhere });
      const processingWhere = {
        ...scope,
        createdAt: dates,
        state: { in: ["PREPARING", "OPEN", "PROCESSING"] },
      };
      const processingCount = await tx.checkoutAttempt.count({ where: processingWhere });
      const metrics: Record<string, { count: number | null; cents: number | null }> = {};
      for (const [key, values] of Object.entries(statuses)) {
        const matching = groups.filter((g) => values.includes(g.status));
        metrics[key] = {
          count: matching.reduce((n, g) => n + g._count, 0),
          cents: matching.reduce((n, g) => n + (g._sum.amountCents ?? 0), 0),
        };
      }
      metrics.refunded = { count: refund._count, cents: refund._sum.cashCents ?? 0 };
      metrics.review = { count: reviewCount, cents: null };
      metrics.processing = { count: processingCount, cents: null };
      for (const k of ["blocked", "net", "balance"])
        metrics[k] = { count: null, cents: null };
      const where = { ...base, status: { in: statuses[category ?? "succeeded"] ?? [] } };
      const payments =
        category && statuses[category]
          ? await tx.payment.findMany({
              where,
              include: { order: { select: { number: true } } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 50,
              skip: (page - 1) * 50,
            })
          : [];
      const adjustments =
        category === "refunded"
          ? await tx.refundAdjustment.findMany({
              where: refundsWhere,
              include: { request: { include: { order: { select: { number: true } } } } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 50,
              skip: (page - 1) * 50,
            })
          : [];
      const attempts = ["review", "processing"].includes(category ?? "")
        ? await tx.checkoutAttempt.findMany({
            where: category === "review" ? reviewWhere : processingWhere,
            include: { order: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 50,
            skip: (page - 1) * 50,
          })
        : [];
      return {
        range,
        live: config.live,
        enabled: config.enabled,
        metrics,
        payments,
        adjustments,
        attempts,
        stripeUrl: `https://dashboard.stripe.com/${/^acct_[A-Za-z0-9]+$/.test(config.accountId ?? "") ? config.accountId + "/" : ""}${config.live ? "" : "test/"}payments`,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
