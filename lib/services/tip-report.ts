import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { financeFilters, financeDayStart } from "@/lib/domain/finance";
import { integrationEnvironment } from "@/lib/integration-environment";
import { financeAccess } from "./finance";
export async function readTipReport(actor: string, raw: unknown) {
  const filter = financeFilters(raw),
    mode = integrationEnvironment();
  if (!mode) throw new AccountError("Reporting environment needs review.", 409);
  const from = financeDayStart(filter.from),
    end = new Date(filter.to + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 1);
  const to = financeDayStart(end.toISOString().slice(0, 10));
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await financeAccess(tx, actor);
      const tips = await tx.deliveryTip.findMany({
        where: {
          livemode: mode === "live",
          OR: [
            { state: "PAID", paidAt: { gte: from, lt: to } },
            { state: { not: "PAID" }, createdAt: { gte: from, lt: to } },
          ],
        },
        include: {
          order: { select: { number: true } },
          deliveryAttempt: { select: { driverUserId: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 251,
      });
      if (tips.length > 250)
        throw new AccountError(
          "Choose a shorter date range. This report supports 250 tip records.",
          422,
        );
      const proof = await tx.auditLog.findMany({
        where: {
          entityType: "DeliveryTip",
          entityId: { in: tips.map((t) => t.id) },
          action: "delivery.tip.reconciled",
        },
        select: { entityId: true, afterJson: true },
      });
      const rows = tips.map((t) => {
        const sourceDriver = (t.source as Record<string, unknown> | null)?.driverUserId;
        const evidence = proof.some((p) => {
          const e = p.afterJson as Record<string, unknown> | null;
          return (
            p.entityId === t.id &&
            e?.state === "PAID" &&
            e.source === "stripe-api" &&
            e.accountId === t.stripeAccountId &&
            e.livemode === t.livemode &&
            e.paymentIntentId === t.paymentIntentId &&
            e.stripeSessionId === t.stripeSessionId &&
            e.taxCents === t.taxCents &&
            e.totalCents === t.totalCents
          );
        });
        const verified =
          t.state === "PAID" &&
          typeof sourceDriver === "string" &&
          evidence &&
          t.taxCents !== null &&
          t.totalCents === t.amountCents + t.taxCents;
        return {
          id: t.id,
          orderId: t.orderId,
          order: t.order.number,
          driverUserId: typeof sourceDriver === "string" ? sourceDriver : "Unconfirmed",
          date: (t.paidAt ?? t.createdAt).toISOString(),
          state: t.state,
          verified,
          tipCents: verified ? t.amountCents : null,
          taxCents: verified ? t.taxCents : null,
          totalCents: verified ? t.totalCents : null,
        };
      });
      return {
        filter,
        mode,
        rows,
        totals: {
          tipCents: rows.reduce((n, r) => n + (r.tipCents ?? 0), 0),
          taxCents: rows.reduce((n, r) => n + (r.taxCents ?? 0), 0),
          totalCents: rows.reduce((n, r) => n + (r.totalCents ?? 0), 0),
          review: rows.filter(
            (r) => !["DECLINED", "EXPIRED"].includes(r.state) && !r.verified,
          ).length,
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
