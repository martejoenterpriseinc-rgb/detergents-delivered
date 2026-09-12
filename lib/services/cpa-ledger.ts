import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { financeFilters, financeDayStart } from "@/lib/domain/finance";
import { businessDate } from "@/lib/domain/operations";
import { integrationEnvironment } from "@/lib/integration-environment";
import { financeAccess } from "./finance";
import { recordedSaleSource, recordedRefundSource } from "./sales-refund-source";
import { recordedOrderCost } from "./quickbooks-cost-source";
export type LedgerRow = {
  id: string;
  sourceId: string;
  orderId: string;
  number: string;
  date: string;
  kind: "SALE" | "SETTLEMENT" | "COMPENSATION" | "REWARD_ONLY" | "STOCK_RETURN";
  cashCents: number | null;
  netCents: number | null;
  taxCents: number | null;
  rewardCents: number | null;
  costCents: number | null;
  subtotalCents: number | null;
  promotionCents: number | null;
  taxEvidence: string;
  issues: string[];
};
function evidenceFailure(error: unknown) {
  if (
    error instanceof ZodError ||
    (error instanceof AccountError && [404, 409].includes(error.status)) ||
    (error instanceof Error &&
      error.message === "Recorded cost exceeds the supported journal limit.")
  )
    return;
  throw error;
}
/** Bounded original-source report; no provider calls, posting or reconstructed history. */
export async function readCpaLedger(actor: string, raw: unknown, exported = false) {
  const input = z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
      page: z.string().optional(),
      orderId: z.string().min(1).max(100).optional(),
    })
    .strict()
    .parse(raw);
  const { orderId, ...datesInput } = input;
  const filter = { ...financeFilters(datesInput), ...(orderId ? { orderId } : {}) };
  const mode = integrationEnvironment();
  if (!mode) throw new AccountError("Accounting environment is unavailable.", 503);
  const end = new Date(new Date(filter.to + "T00:00:00Z").getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
  const dates = { gte: financeDayStart(filter.from), lt: financeDayStart(end) };
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await financeAccess(tx, actor);
      const scope = {
        ...(orderId ? { id: orderId } : {}),
        currency: "USD",
        checkoutAttempt: { state: "PAID", livemode: mode === "live" },
      };
      const [sales, refunds, returns] = await Promise.all([
        tx.order.findMany({
          where: { ...scope, placedAt: dates },
          select: { id: true, number: true, placedAt: true },
          orderBy: { id: "asc" },
          take: 251,
        }),
        tx.refundAdjustment.findMany({
          where: {
            createdAt: dates,
            currency: "USD",
            request: { livemode: mode === "live", order: scope },
          },
          select: {
            id: true,
            kind: true,
            createdAt: true,
            request: { select: { orderId: true, order: { select: { number: true } } } },
          },
          orderBy: { id: "asc" },
          take: 251,
        }),
        tx.stockReturn.findMany({
          where: { receivedAt: dates, order: scope },
          select: {
            id: true,
            orderId: true,
            receivedAt: true,
            order: { select: { number: true } },
          },
          orderBy: { id: "asc" },
          take: 251,
        }),
      ]);
      if (sales.length + refunds.length + returns.length > 250)
        throw new AccountError(
          "Narrow the dates to review at most 250 financial events. No partial report was returned.",
          422,
        );
      const rows: LedgerRow[] = [];
      const row = (
        kind: LedgerRow["kind"],
        sourceId: string,
        orderId: string,
        number: string,
        date: Date,
      ): LedgerRow => ({
        id: kind + ":" + sourceId,
        sourceId,
        orderId,
        number,
        date: businessDate(date),
        kind,
        cashCents: null,
        netCents: null,
        taxCents: null,
        rewardCents: null,
        costCents: null,
        subtotalCents: null,
        promotionCents: null,
        taxEvidence: "UNAVAILABLE",
        issues: [],
      });
      for (const s of sales) {
        const r = row("SALE", s.id, s.id, s.number, s.placedAt!);
        try {
          const v = await recordedSaleSource(tx, s.id);
          Object.assign(r, {
            cashCents: v.cashCents,
            netCents: v.netCents,
            taxCents: v.taxCents,
            rewardCents: -v.rewardsCents,
            subtotalCents: v.subtotalCents,
            promotionCents: v.promotionCents,
            taxEvidence: "ORIGINAL",
          });
        } catch (e) {
          evidenceFailure(e);
          r.issues.push("Original financial evidence needs review");
        }
        try {
          r.costCents = (await recordedOrderCost(tx, s.id)).amountCents;
        } catch (e) {
          evidenceFailure(e);
          r.issues.push("Original cost evidence needs review");
        }
        rows.push(r);
      }
      for (const a of refunds) {
        const kind = z.enum(["SETTLEMENT", "COMPENSATION", "REWARD_ONLY"]).parse(a.kind);
        const r = row(kind, a.id, a.request.orderId, a.request.order.number, a.createdAt);
        try {
          const v = await recordedRefundSource(tx, r.orderId, a.id);
          Object.assign(r, {
            cashCents: -v.cashCents,
            netCents: -v.netCents,
            taxCents: -v.taxCents,
            rewardCents: v.rewardCents,
            subtotalCents: 0,
            promotionCents: 0,
            costCents: 0,
            taxEvidence: v.taxEvidenceStatus,
          });
          if (v.taxEvidenceStatus === "UNVERIFIED")
            r.issues.push("Provider tax matching pending");
        } catch (e) {
          evidenceFailure(e);
          r.issues.push("Refund financial evidence needs review");
        }
        rows.push(r);
      }
      for (const a of returns) {
        const r = row("STOCK_RETURN", a.id, a.orderId, a.order.number, a.receivedAt);
        // Receiving stock does not itself move cash, tax or rewards.
        Object.assign(r, {
          cashCents: 0,
          netCents: 0,
          taxCents: 0,
          rewardCents: 0,
          subtotalCents: 0,
          promotionCents: 0,
          taxEvidence: "NOT_APPLICABLE",
        });
        try {
          const v = await recordedOrderCost(tx, a.orderId, a.id);
          Object.assign(r, {
            cashCents: 0,
            netCents: 0,
            taxCents: 0,
            rewardCents: 0,
            subtotalCents: 0,
            promotionCents: 0,
            costCents: -v.amountCents,
            taxEvidence: "NOT_APPLICABLE",
          });
        } catch (e) {
          evidenceFailure(e);
          r.issues.push("Return cost evidence needs review");
        }
        rows.push(r);
      }
      rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
      const fields = [
        "cashCents",
        "netCents",
        "taxCents",
        "rewardCents",
        "costCents",
        "subtotalCents",
        "promotionCents",
      ] as const;
      const totals = Object.fromEntries(
        fields.map((key) => [key, rows.reduce((sum, r) => sum + (r[key] ?? 0), 0)]),
      ) as Record<(typeof fields)[number], number>;
      const missingFinancial = rows.filter((r) => r.cashCents === null).length;
      const missingCost = rows.filter((r) => r.costCents === null).length;
      return {
        filter,
        mode,
        currency: "USD" as const,
        checkedAt: new Date().toISOString(),
        count: rows.length,
        attention: rows.filter((r) => r.issues.length).length,
        missingFinancial,
        missingCost,
        pendingTax: rows.filter((r) => r.taxEvidence === "UNVERIFIED").length,
        totals,
        merchandiseLessCostCents:
          missingFinancial || missingCost ? null : totals.netCents - totals.costCents,
        rows: exported ? rows : rows.slice((filter.page - 1) * 50, filter.page * 50),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
  );
}
