import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountIdentity } from "@/lib/services/customer-account";
import { AccountError } from "@/lib/domain/account";
import {
  financeFilters,
  financeInput,
  financeKind,
  financeDayStart,
} from "@/lib/domain/finance";
import { businessDate } from "@/lib/domain/operations";

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function financeAccess(
  db: Prisma.TransactionClient,
  userId: string,
  write = false,
) {
  const user = await accountIdentity(db, userId);
  const canWrite = user.userRoles.some((r) =>
    ["ADMIN", "SUPER_ADMIN"].includes(r.role.code),
  );
  if (!canWrite && (write || !user.userRoles.some((r) => r.role.code === "CPA")))
    throw new AccountError("Financial access required.", 403);
  return canWrite;
}
export async function saveFinance(userId: string, input: unknown) {
  const data = financeInput.parse(input);
  const requestId =
    "finance_" +
    createHash("sha256")
      .update(userId + ":" + data.requestKey)
      .digest("hex");
  const entityType = data.kind === "expense" ? "Expense" : "MileageTrip";
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, userId, true);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`;
    const previousRequest = await tx.auditLog.findUnique({ where: { id: requestId } });
    if (previousRequest) {
      const previous = previousRequest.afterJson as { input?: unknown; version?: number };
      if (!isDeepStrictEqual(previous.input, json(data)))
        throw new AccountError(
          "This save was already used. Refresh before changing the record.",
          409,
        );
      return { id: previousRequest.entityId!, version: previous.version! };
    }
    const id = data.id ?? requestId;
    // One record lock serializes edits; a vehicle lock also protects odometer overlap.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${entityType + ":" + id}, 0))`;
    const before =
      data.kind === "expense"
        ? await tx.expense.findUnique({ where: { id } })
        : await tx.mileageTrip.findUnique({ where: { id } });
    if (data.id && !before) throw new AccountError("Record not found.", 404);
    const version = await tx.auditLog.count({
      where: { entityType, entityId: id, action: { startsWith: "finance." } },
    });
    if (data.version !== version)
      throw new AccountError(
        "This record changed. Reload it before saving your correction.",
        409,
      );
    if (data.kind === "expense") {
      const old = before as { qboTxnId?: string | null; currency?: string } | null;
      if (old?.qboTxnId || (old && old.currency !== "USD"))
        throw new AccountError(
          "This record requires accounting reconciliation before editing.",
          409,
        );
      const category = await tx.expenseCategory.upsert({
        where: { name: data.category },
        update: {},
        create: { name: data.category },
      });
      const fields = {
        categoryId: category.id,
        amountCents: data.amount,
        incurredOn: new Date(data.date + "T00:00:00Z"),
        memo: data.memo,
      };
      if (before) await tx.expense.update({ where: { id }, data: fields });
      else await tx.expense.create({ data: { id, ...fields } });
    } else {
      const old = before as {
        driverUserId?: string;
        routeId?: string | null;
        vehicleId?: string;
      } | null;
      if (old && (old.driverUserId !== userId || old.routeId))
        throw new AccountError(
          "Only your own manually recorded trips can be corrected here.",
          403,
        );
      if (old && old.vehicleId !== data.vehicleId)
        throw new AccountError("A saved trip cannot be moved to another vehicle.", 409);
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${data.vehicleId} FOR UPDATE`;
      if (
        !(await tx.vehicle.findFirst({ where: { id: data.vehicleId, isActive: true } }))
      )
        throw new AccountError("Choose an active vehicle.");
      const overlap = await tx.mileageTrip.findFirst({
        where: {
          vehicleId: data.vehicleId,
          id: { not: id },
          startOdometer: { lt: data.endOdometer },
          endOdometer: { gt: data.startOdometer },
        },
      });
      if (overlap)
        throw new AccountError(
          "These odometer readings overlap a saved trip for this vehicle.",
          409,
        );
      const fields = {
        vehicleId: data.vehicleId,
        startOdometer: data.startOdometer,
        endOdometer: data.endOdometer,
        miles: new Prisma.Decimal(data.endOdometer - data.startOdometer),
        purpose: data.purpose,
        startedAt: new Date(data.date + "T12:00:00Z"),
        endedAt: new Date(data.date + "T12:00:00Z"),
      };
      if (before) await tx.mileageTrip.update({ where: { id }, data: fields });
      else await tx.mileageTrip.create({ data: { id, driverUserId: userId, ...fields } });
    }
    await tx.auditLog.create({
      data: {
        id: requestId,
        actorUserId: userId,
        action: `finance.${data.kind}.${before ? "corrected" : "recorded"}`,
        entityType,
        entityId: id,
        ...(before ? { beforeJson: json(before) } : {}),
        afterJson: json({ input: data, version: version + 1 }),
      },
    });
    return { id, version: version + 1 };
  });
}

export async function readFinance(
  userId: string,
  kindInput: unknown,
  filterInput: unknown,
  exporting = false,
) {
  const kind = financeKind.parse(kindInput),
    filters = financeFilters(filterInput);
  return prisma.$transaction(
    async (tx) => {
      const canWrite = await financeAccess(tx, userId);
      const range = {
        gte: new Date(filters.from + "T00:00:00Z"),
        lt: new Date(new Date(filters.to + "T00:00:00Z").getTime() + 86400000),
      };
      const window = {
        skip: exporting ? 0 : (filters.page - 1) * 50,
        take: exporting ? 10001 : 50,
      };
      const entityType = kind === "expense" ? "Expense" : "MileageTrip";
      let rows: Array<{
        id: string;
        date: string;
        label: string;
        description: string;
        amount: string;
        currency: string;
        vehicleId?: string;
        startOdometer?: number | null;
        endOdometer?: number | null;
        editable: boolean;
        version: number;
      }>;
      let count: number, total: string;
      if (kind === "expense") {
        const where = { incurredOn: range };
        const records = await tx.expense.findMany({
          where,
          ...window,
          include: { category: true },
          orderBy: [{ incurredOn: "desc" }, { id: "desc" }],
        });
        count = await tx.expense.count({ where });
        // Other currencies stay visible, but are never added to the USD total.
        const aggregate = await tx.expense.aggregate({
          where: { ...where, currency: "USD" },
          _sum: { amountCents: true },
        });
        const cents = aggregate._sum.amountCents ?? 0;
        if (!Number.isSafeInteger(cents))
          throw new AccountError(
            "Expense total exceeds the supported range. Narrow the dates.",
          );
        total = (cents / 100).toFixed(2);
        rows = records.map((r) => ({
          id: r.id,
          date: r.incurredOn.toISOString().slice(0, 10),
          label: r.category.name,
          description: r.memo ?? "",
          amount: (r.amountCents / 100).toFixed(2),
          currency: r.currency,
          editable: canWrite && !r.qboTxnId && r.currency === "USD",
          version: 0,
        }));
      } else {
        const tomorrow = new Date(
          new Date(filters.to + "T00:00:00Z").getTime() + 86400000,
        )
          .toISOString()
          .slice(0, 10);
        const where = {
          startedAt: {
            gte: financeDayStart(filters.from),
            lt: financeDayStart(tomorrow),
          },
        };
        const records = await tx.mileageTrip.findMany({
          where,
          ...window,
          include: { vehicle: true },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        });
        count = await tx.mileageTrip.count({ where });
        const aggregate = await tx.mileageTrip.aggregate({
          where,
          _sum: { miles: true },
        });
        total = aggregate._sum.miles?.toFixed(2) ?? "0.00";
        rows = records.map((r) => ({
          id: r.id,
          date: businessDate(r.startedAt),
          label: r.vehicle.name,
          description: r.purpose ?? "",
          amount: r.miles?.toFixed(2) ?? "",
          currency: "miles",
          vehicleId: r.vehicleId,
          startOdometer: r.startOdometer,
          endOdometer: r.endOdometer,
          editable:
            canWrite && r.driverUserId === userId && !r.routeId && r.vehicle.isActive,
          version: 0,
        }));
      }
      if (exporting && rows.length > 10000)
        throw new AccountError(
          "Narrow the date range to export 10,000 or fewer records.",
        );
      const versions = await tx.auditLog.groupBy({
        by: ["entityId"],
        where: {
          entityType,
          entityId: { in: rows.map((r) => r.id) },
          action: { startsWith: "finance." },
        },
        _count: { _all: true },
      });
      rows.forEach(
        (r) => (r.version = versions.find((v) => v.entityId === r.id)?._count._all ?? 0),
      );
      return {
        kind,
        filters,
        canWrite,
        rows,
        count,
        total,
        vehicles:
          kind === "mileage"
            ? await tx.vehicle.findMany({
                where: { isActive: true },
                select: { id: true, name: true },
                orderBy: { name: "asc" },
                take: 500,
              })
            : [],
        categories:
          kind === "expense"
            ? await tx.expenseCategory.findMany({
                select: { name: true },
                orderBy: { name: "asc" },
                take: 500,
              })
            : [],
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
