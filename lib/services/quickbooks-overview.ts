import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { financeAccess } from "./finance";
import { quickbooksConfig } from "@/lib/integrations/quickbooks-client";
import { paymentPeriod } from "@/lib/domain/payment-overview";

export const quickbooksCategories = {
  sales: "Sales receipts",
  refunds: "Refund receipts",
  expenses: "Expense exports",
  costs: "Inventory cost journals",
  pending: "Pending reconciliation",
  corrections: "Accounting corrections",
} as const;
export type QuickbooksCategory = keyof typeof quickbooksCategories;
export async function quickbooksOverview(actor: string, rawPeriod?: unknown) {
  await financeAccess(prisma, actor);
  const period = paymentPeriod(rawPeriod);
  let config;
  try {
    config = await quickbooksConfig();
  } catch {
    return {
      period,
      configured: false as const,
      realm: null,
      mode: null,
      counts: null,
      checkedAt: new Date().toISOString(),
    };
  }
  const scope = { mode: config.mode, realm: config.realm };
  const confirmedAt = { gte: period.start, lt: period.end };
  const pending = { ...scope, status: { in: ["SUBMITTING", "UNKNOWN"] } };
  const corrections = {
    ...scope,
    status: { not: "CANCELED" },
    reconciliationIssue: { not: null },
  };
  const counts = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [
        sales,
        refunds,
        expenses,
        costs,
        pendingReceipts,
        pendingExpenses,
        pendingCosts,
        correctionReceipts,
        correctionExpenses,
        correctionCosts,
      ] = await Promise.all([
        tx.qboReceiptExport.count({
          where: { ...scope, confirmedAt, entity: "SalesReceipt", status: "POSTED" },
        }),
        tx.qboReceiptExport.count({
          where: { ...scope, confirmedAt, entity: "RefundReceipt", status: "POSTED" },
        }),
        tx.qboExpenseExport.count({ where: { ...scope, confirmedAt, status: "POSTED" } }),
        tx.qboCostExport.count({ where: { ...scope, confirmedAt, status: "POSTED" } }),
        tx.qboReceiptExport.count({ where: pending }),
        tx.qboExpenseExport.count({ where: pending }),
        tx.qboCostExport.count({ where: pending }),
        tx.qboReceiptExport.count({ where: corrections }),
        tx.qboExpenseExport.count({ where: corrections }),
        tx.qboCostExport.count({ where: corrections }),
      ]);
      return {
        sales,
        refunds,
        expenses,
        costs,
        pending: pendingReceipts + pendingExpenses + pendingCosts,
        corrections: correctionReceipts + correctionExpenses + correctionCosts,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return {
    period,
    configured: true as const,
    realm: config.realm,
    mode: config.mode,
    counts,
    checkedAt: new Date().toISOString(),
  };
}

export async function quickbooksOverviewRecords(
  actor: string,
  category: QuickbooksCategory,
  rawPeriod?: unknown,
) {
  await financeAccess(prisma, actor);
  let config;
  try {
    config = await quickbooksConfig();
  } catch {
    return [];
  }
  const period = paymentPeriod(rawPeriod);
  const scope = { mode: config.mode, realm: config.realm };
  const where =
    category === "pending"
      ? { ...scope, status: { in: ["SUBMITTING", "UNKNOWN"] } }
      : category === "corrections"
        ? { ...scope, status: { not: "CANCELED" }, reconciliationIssue: { not: null } }
        : {
            ...scope,
            status: "POSTED",
            confirmedAt: { gte: period.start, lt: period.end },
          };
  const select = {
    id: true,
    docNumber: true,
    status: true,
    externalId: true,
    reconciliationIssue: true,
    createdAt: true,
    confirmedAt: true,
  } as const;
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [receipts, expenses, costs] = await Promise.all([
        ["sales", "refunds", "pending", "corrections"].includes(category)
          ? tx.qboReceiptExport.findMany({
              where: {
                ...where,
                ...(category === "sales"
                  ? { entity: "SalesReceipt" }
                  : category === "refunds"
                    ? { entity: "RefundReceipt" }
                    : {}),
              },
              select,
              orderBy,
              take: 50,
            })
          : [],
        ["expenses", "pending", "corrections"].includes(category)
          ? tx.qboExpenseExport.findMany({ where, select, orderBy, take: 50 })
          : [],
        ["costs", "pending", "corrections"].includes(category)
          ? tx.qboCostExport.findMany({ where, select, orderBy, take: 50 })
          : [],
      ]);
      return [
        ...receipts.map((r) => ({ ...r, kind: "Receipt" })),
        ...expenses.map((r) => ({ ...r, kind: "Expense" })),
        ...costs.map((r) => ({ ...r, kind: "Cost journal" })),
      ]
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
        )
        .slice(0, 50);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
