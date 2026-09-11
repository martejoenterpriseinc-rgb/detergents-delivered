import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type Expense, type QboExpenseExport } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { financeAccess } from "./finance";
import { authorizedQuickbooks, assertQuickbooksSnapshot } from "./quickbooks-connection";
import { quickbooksMappingSchema } from "./quickbooks-mapping";
import {
  quickbooksConfig,
  readQuickbooksAccount,
  createQuickbooksExpense,
  findQuickbooksExpense,
} from "@/lib/integrations/quickbooks-client";
import {
  qboExpenseSource,
  qboExpensePayload,
  matchQboExpense,
} from "@/lib/domain/quickbooks-expense";
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const source = (e: Expense) =>
  qboExpenseSource.parse({
    categoryId: e.categoryId,
    amountCents: e.amountCents,
    currency: e.currency,
    date: e.incurredOn.toISOString().slice(0, 10),
    memo: e.memo ?? "",
  });
const publicExport = (e: QboExpenseExport) => ({
  id: e.id,
  status: e.status,
  realm: e.realm,
  docNumber: e.docNumber,
  source: qboExpenseSource.parse(e.source),
  mapping: quickbooksMappingSchema.parse(e.mapping),
  externalId: e.externalId,
  submittedAt: e.submittedAt?.toISOString() ?? null,
  confirmedAt: e.confirmedAt?.toISOString() ?? null,
});
async function expenseLock(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"Expense:" + id},0))`;
}
function postingAllowed(mode: string, realm: string) {
  return (
    process.env.DD_QBO_EXPENSE_POSTING_ENABLED === "true" &&
    process.env.DD_QBO_EXPENSE_POSTING_COMPANY === mode + ":" + realm
  );
}
export async function listQuickbooksExpenses(actor: string, cursor?: string) {
  z.string().min(1).max(100).optional().parse(cursor);
  const canWrite = await financeAccess(prisma, actor);
  let canSubmit = false;
  try {
    const c = await quickbooksConfig();
    canSubmit = postingAllowed(c.mode, c.realm);
  } catch {}
  const rows = await prisma.expense.findMany({
    orderBy: [{ incurredOn: "desc" }, { id: "desc" }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      category: { select: { name: true } },
      quickbooksExports: { where: { status: { not: "CANCELED" } }, take: 1 },
    },
  });
  return {
    canWrite,
    canSubmit,
    nextCursor: rows.length > 50 ? rows[49].id : null,
    rows: rows.slice(0, 50).map((e) => ({
      id: e.id,
      date: e.incurredOn.toISOString().slice(0, 10),
      category: e.category.name,
      memo: e.memo,
      amountCents: e.amountCents,
      currency: e.currency,
      linked: Boolean(e.qboTxnId),
      export: e.quickbooksExports[0] ? publicExport(e.quickbooksExports[0]) : null,
    })),
  };
}
export async function prepareQuickbooksExpense(actor: string, raw: unknown) {
  const input = z
    .object({
      requestKey: z.uuid(),
      expenseId: z.string().min(1).max(100),
      paymentType: z.enum(["Cash", "CreditCard"]),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const config = await quickbooksConfig(),
    id = "qbe_" + digest(actor + ":" + input.requestKey),
    requestHash = digest(JSON.stringify(input));
  const previous = await prisma.qboExpenseExport.findUnique({ where: { id } });
  if (previous) {
    if (
      previous.requestHash !== requestHash ||
      previous.mode !== config.mode ||
      previous.realm !== config.realm
    )
      throw new AccountError(
        "This preparation request was already used for different choices.",
        409,
      );
    return publicExport(previous);
  }
  const snapshot = await authorizedQuickbooks(actor);
  if (config.fingerprint !== snapshot.config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    await expenseLock(tx, input.expenseId);
    const prior = await tx.qboExpenseExport.findUnique({ where: { id } });
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new AccountError("Preparation request changed.", 409);
      return publicExport(prior);
    }
    const e = await tx.expense.findUnique({ where: { id: input.expenseId } });
    if (!e) throw new AccountError("Expense not found.", 404);
    if (
      e.qboTxnId ||
      (await tx.qboExpenseExport.findFirst({
        where: { expenseId: e.id, status: { not: "CANCELED" } },
      }))
    )
      throw new AccountError(
        "This expense already has an accounting export. Review it instead of preparing another.",
        409,
      );
    const row = await tx.setting.findUnique({
      where: {
        key: `quickbooks:expense-map:v1:${config.mode}:${config.realm}:${e.categoryId}`,
      },
    });
    if (!row) throw new AccountError("Map this expense category first.", 409);
    const mapping = quickbooksMappingSchema.parse(row.valueJson),
      savedSource = source(e);
    if (
      mapping.mode !== config.mode ||
      mapping.realm !== config.realm ||
      mapping.categoryId !== e.categoryId ||
      (input.paymentType === "CreditCard") !==
        (mapping.paymentAccount.type === "Credit Card")
    )
      throw new AccountError(
        "Choose the payment type that matches the mapped account.",
        409,
      );
    const payload = qboExpensePayload.parse({
      DocNumber: "DD" + digest(id).slice(0, 19),
      TxnDate: savedSource.date,
      PaymentType: input.paymentType,
      AccountRef: { value: mapping.paymentAccount.id },
      CurrencyRef: { value: "USD" },
      Line: [
        {
          Amount: savedSource.amountCents / 100,
          Description: savedSource.memo,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: mapping.expenseAccount.id },
          },
        },
      ],
    });
    const created = await tx.qboExpenseExport.create({
      data: {
        id,
        expenseId: e.id,
        mode: config.mode,
        realm: config.realm,
        docNumber: payload.DocNumber,
        requestHash,
        source: json(savedSource),
        mapping: json(mapping),
        payload: json(payload),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "quickbooks.expense.prepared",
        entityType: "QboExpenseExport",
        entityId: id,
        afterJson: { expenseId: e.id, realm: config.realm, docNumber: payload.DocNumber },
      },
    });
    return publicExport(created);
  });
}
export async function cancelQuickbooksExpense(actor: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    const e = await tx.qboExpenseExport.findUnique({ where: { id } });
    if (!e) throw new AccountError("Export not found.", 404);
    await expenseLock(tx, e.expenseId);
    const current = await tx.qboExpenseExport.findUniqueOrThrow({ where: { id } });
    if (current.status === "CANCELED") return { canceled: true };
    if (current.status !== "DRAFT")
      throw new AccountError(
        "A submitted export must be reconciled; it cannot be canceled here.",
        409,
      );
    await tx.qboExpenseExport.update({ where: { id }, data: { status: "CANCELED" } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "quickbooks.expense.canceled",
        entityType: "QboExpenseExport",
        entityId: id,
      },
    });
    return { canceled: true };
  });
}
async function confirm(
  actor: string,
  id: string,
  receipt: unknown,
  snapshot: Awaited<ReturnType<typeof authorizedQuickbooks>>,
) {
  if ((await quickbooksConfig()).fingerprint !== snapshot.config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    const first = await tx.qboExpenseExport.findUniqueOrThrow({ where: { id } });
    await expenseLock(tx, first.expenseId);
    const record = await tx.qboExpenseExport.findUniqueOrThrow({ where: { id } });
    const externalId = matchQboExpense(receipt, record.payload);
    if (record.mode !== snapshot.config.mode || record.realm !== snapshot.config.realm)
      throw new AccountError("Accounting company does not match.", 409);
    if (record.status === "POSTED") {
      if (record.externalId !== externalId)
        throw new AccountError("Accounting evidence changed.", 409);
      return publicExport(record);
    }
    if (!["SUBMITTING", "UNKNOWN"].includes(record.status))
      throw new AccountError("Export is not awaiting confirmation.", 409);
    const e = await tx.expense.findUniqueOrThrow({ where: { id: record.expenseId } });
    if (e.qboTxnId || !isDeepStrictEqual(source(e), record.source))
      throw new AccountError("Expense changed and needs accounting review.", 409);
    await tx.expense.update({
      where: { id: e.id },
      data: { qboTxnId: `qbo:${record.mode}:${record.realm}:${externalId}` },
    });
    const posted = await tx.qboExpenseExport.update({
      where: { id },
      data: { status: "POSTED", externalId, confirmedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "quickbooks.expense.confirmed",
        entityType: "QboExpenseExport",
        entityId: id,
        afterJson: { externalId, realm: record.realm },
      },
    });
    return publicExport(posted);
  });
}
export async function submitQuickbooksExpense(actor: string, id: string) {
  await financeAccess(prisma, actor, true);
  const snapshot = await authorizedQuickbooks(actor),
    config = snapshot.config;
  if (!postingAllowed(config.mode, config.realm))
    throw new AccountError("Expense posting is not enabled for this company.", 409);
  const before = await prisma.qboExpenseExport.findUnique({ where: { id } });
  if (!before) throw new AccountError("Export not found.", 404);
  if (before.status !== "DRAFT") return publicExport(before);
  if (before.mode !== config.mode || before.realm !== config.realm)
    throw new AccountError("Accounting company does not match.", 409);
  const mapping = quickbooksMappingSchema.parse(before.mapping);
  const [expense, payment] = await Promise.all([
    readQuickbooksAccount(config, snapshot.accessToken, mapping.expenseAccount.id),
    readQuickbooksAccount(config, snapshot.accessToken, mapping.paymentAccount.id),
  ]);
  if (
    !expense.Active ||
    !payment.Active ||
    expense.Id !== mapping.expenseAccount.id ||
    payment.Id !== mapping.paymentAccount.id ||
    expense.AccountType !== mapping.expenseAccount.type ||
    payment.AccountType !== mapping.paymentAccount.type ||
    expense.CurrencyRef?.value !== "USD" ||
    payment.CurrencyRef?.value !== "USD"
  )
    throw new AccountError(
      "Mapped accounts changed. Cancel this draft and review its mapping.",
      409,
    );
  if ((await quickbooksConfig()).fingerprint !== config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  const claim = await prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    await expenseLock(tx, before.expenseId);
    const current = await tx.qboExpenseExport.findUniqueOrThrow({ where: { id } });
    if (current.status !== "DRAFT") return null;
    const currentMapping = await tx.setting.findUnique({
      where: {
        key: `quickbooks:expense-map:v1:${config.mode}:${config.realm}:${mapping.categoryId}`,
      },
    });
    if (
      !currentMapping ||
      !isDeepStrictEqual(quickbooksMappingSchema.parse(currentMapping.valueJson), mapping)
    )
      throw new AccountError(
        "Expense mapping changed. Cancel and prepare a fresh draft.",
        409,
      );
    const e = await tx.expense.findUniqueOrThrow({ where: { id: current.expenseId } });
    if (e.qboTxnId || !isDeepStrictEqual(source(e), current.source))
      throw new AccountError("Expense changed.", 409);
    await tx.qboExpenseExport.update({
      where: { id },
      data: { status: "SUBMITTING", submittedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        action: "quickbooks.expense.submitting",
        entityType: "QboExpenseExport",
        entityId: id,
      },
    });
    return current;
  });
  if (!claim)
    return publicExport(
      await prisma.qboExpenseExport.findUniqueOrThrow({ where: { id } }),
    );
  try {
    return await confirm(
      actor,
      id,
      await createQuickbooksExpense(config, snapshot.accessToken, claim.payload),
      snapshot,
    );
  } catch {
    await prisma.qboExpenseExport.updateMany({
      where: { id, status: "SUBMITTING" },
      data: { status: "UNKNOWN" },
    });
    throw new AccountError(
      "Submission was not confirmed. Reconcile this export; do not create another transaction.",
      503,
    );
  }
}
export async function reconcileQuickbooksExpense(actor: string, id: string) {
  await financeAccess(prisma, actor, true);
  const snapshot = await authorizedQuickbooks(actor),
    record = await prisma.qboExpenseExport.findUnique({ where: { id } });
  if (!record) throw new AccountError("Export not found.", 404);
  if (record.mode !== snapshot.config.mode || record.realm !== snapshot.config.realm)
    throw new AccountError("Accounting company does not match.", 409);
  if (!["SUBMITTING", "UNKNOWN", "POSTED"].includes(record.status))
    throw new AccountError("This export has not been submitted.", 409);
  const matches = await findQuickbooksExpense(
    snapshot.config,
    snapshot.accessToken,
    record.docNumber,
  );
  if (matches.length !== 1)
    throw new AccountError(
      "A unique matching QuickBooks expense was not found. Keep this export blocked for accounting review.",
      409,
    );
  return confirm(actor, id, matches[0], snapshot);
}
