import { integrationEnvironment } from "@/lib/integration-environment";
import { recordedSaleSource, recordedRefundSource } from "./sales-refund-source";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { financeAccess } from "./finance";
import { financeFilters, financeDayStart } from "@/lib/domain/finance";
import { AccountError } from "@/lib/domain/account";

/** Recorded sale tax and signed refund allocations, not a tax filing determination. */
export async function readTaxReview(userId: string, raw: unknown) {
  const filter = financeFilters(raw);
  const mode = integrationEnvironment();
  if (!mode) throw new AccountError("Accounting environment is unavailable.", 503);
  const end = new Date(new Date(filter.to + "T00:00:00Z").getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
  const dates = { gte: financeDayStart(filter.from), lt: financeDayStart(end) };
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const canMatchTax = await financeAccess(tx, userId);
      const [orders, adjustments] = await Promise.all([
        tx.order.findMany({
          where: {
            currency: "USD",
            checkoutAttempt: { state: "PAID", livemode: mode === "live" },
            OR: [
              {
                checkoutAttempt: { paymentMethod: "STRIPE" },
                OR: [{ placedAt: dates }, { placedAt: null, createdAt: dates }],
              },
              {
                checkoutAttempt: {
                  paymentMethod: { in: ["CASH", "ZELLE"] },
                  manualSettlement: { receivedAt: dates },
                },
              },
            ],
          },
          include: {
            checkoutAttempt: {
              select: {
                id: true,
                paymentMethod: true,
                manualSettlement: { select: { receivedAt: true } },
              },
            },
            items: { select: { taxCents: true } },
            payments: { include: { events: true } },
          },
          take: 5001,
        }),
        tx.refundAdjustment.findMany({
          where: {
            currency: "USD",
            createdAt: dates,
            kind: { not: "REWARD_ONLY" },
            request: { livemode: mode === "live" },
          },
          include: {
            taxEvidence: true,
            request: {
              select: {
                orderId: true,
                payment: { select: { provider: true } },
                order: { select: { number: true } },
              },
            },
          },
          take: 5001,
        }),
      ]);
      if (orders.length > 5000 || adjustments.length > 5000)
        throw new AccountError(
          "Narrow the dates to review at most 5,000 records per source.",
          422,
        );
      const manualSales = new Set<string>();
      for (const o of orders.filter(
        (o) => o.checkoutAttempt?.paymentMethod !== "STRIPE",
      )) {
        try {
          await recordedSaleSource(tx, o.id);
          manualSales.add(o.id);
        } catch (e) {
          if (!(e instanceof AccountError)) throw e;
        }
      }
      const manualTax = new Set<string>();
      for (const a of adjustments.filter(
        (a) => a.request.payment.provider === "MANUAL",
      )) {
        const source = await recordedRefundSource(tx, a.request.orderId, a.id);
        if (source.taxEvidenceStatus === "MATCHED") manualTax.add(a.id);
      }
      const trusted = orders.filter(
        (o) =>
          manualSales.has(o.id) ||
          (o.items.reduce((n, i) => n + i.taxCents, 0) === o.taxCents &&
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
                    [
                      "checkout.session.completed",
                      "checkout.session.reconciled",
                    ].includes(e.type),
                ),
            )),
      );
      const rows = [
        ...trusted.map((o) => ({
          id: o.id,
          orderId: o.id,
          number: o.number,
          date: (
            o.checkoutAttempt?.manualSettlement?.receivedAt ??
            o.placedAt ??
            o.createdAt
          ).toISOString(),
          kind: "SALE",
          taxCents: o.taxCents,
          evidence: "Saved paid order",
          canMatch: false,
          manualRefundUrl: null as string | null,
        })),
        ...adjustments.map((a) => ({
          id: a.id,
          orderId: a.request.orderId,
          number: a.request.order.number,
          date: a.createdAt.toISOString(),
          kind: a.kind,
          taxCents: a.taxCents,
          evidence: manualTax.has(a.id)
            ? "Manual refund tax reversal verified"
            : a.taxEvidence
              ? "Stripe tax report matched"
              : "Provider tax matching pending",
          canMatch:
            canMatchTax &&
            a.request.payment.provider === "STRIPE" &&
            a.kind === "SETTLEMENT" &&
            !a.taxEvidence,
          manualRefundUrl:
            a.request.payment.provider === "MANUAL"
              ? `/admin/payments/manual/${a.request.orderId}`
              : null,
        })),
      ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
      return {
        filter,
        saleTaxCents: trusted.reduce((n, o) => n + o.taxCents, 0),
        refundTaxCents: adjustments.reduce((n, a) => n + a.taxCents, 0),
        unverifiedAdjustments: adjustments.filter(
          (a) => !a.taxEvidence && !manualTax.has(a.id),
        ).length,
        excludedOrders: orders.length - trusted.length,
        count: rows.length,
        rows: rows.slice((filter.page - 1) * 50, filter.page * 50),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
