import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { financeAccess } from "./finance";
import { authorizedQuickbooks, assertQuickbooksSnapshot } from "./quickbooks-connection";
import {
  quickbooksConfig,
  readQuickbooksAccount,
  readQuickbooksAccounts,
} from "@/lib/integrations/quickbooks-client";
const inputSchema = z
  .object({
    requestKey: z.uuid(),
    categoryId: z.string().min(1).max(100),
    expenseAccountId: z.string().regex(/^\d{1,30}$/),
    paymentAccountId: z.string().regex(/^\d{1,30}$/),
    version: z.number().int().min(0),
    confirmed: z.literal(true),
  })
  .strict();
const account = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  currency: z.literal("USD"),
});
export const quickbooksMappingSchema = z
  .object({
    version: z.number().int().positive(),
    mode: z.enum(["sandbox", "live"]),
    realm: z.string(),
    categoryId: z.string(),
    expenseAccount: account,
    paymentAccount: account,
    verifiedAt: z.string().datetime(),
  })
  .strict();
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const mappingKey = (mode: string, realm: string, categoryId: string) =>
  `quickbooks:expense-map:v1:${mode}:${realm}:${categoryId}`;
export async function quickbooksAccountChoices(actor: string, raw: unknown) {
  const { start } = z
    .object({ start: z.number().int().min(1).max(100001).default(1) })
    .strict()
    .parse(raw);
  const snapshot = await authorizedQuickbooks(actor),
    result = await readQuickbooksAccounts(snapshot.config, snapshot.accessToken, start);
  await prisma.$transaction((tx) => assertQuickbooksSnapshot(tx, actor, snapshot));
  return { realm: snapshot.config.realm, ...result };
}
export async function quickbooksMappingData(actor: string) {
  const canWrite = await financeAccess(prisma, actor);
  const config = await quickbooksConfig();
  const categories = await prisma.expenseCategory.findMany({
    orderBy: { name: "asc" },
    take: 251,
    select: { id: true, name: true },
  });
  if (categories.length > 250)
    throw new AccountError(
      "There are more than 250 expense categories. Narrow the accounting setup before mapping.",
      409,
    );
  const rows = await prisma.setting.findMany({
    where: {
      key: { in: categories.map((c) => mappingKey(config.mode, config.realm, c.id)) },
    },
  });
  return {
    canWrite,
    realm: config.realm,
    categories: categories.map((c) => ({
      ...c,
      mapping: rows.find((r) => r.key === mappingKey(config.mode, config.realm, c.id))
        ?.valueJson
        ? quickbooksMappingSchema.parse(
            rows.find((r) => r.key === mappingKey(config.mode, config.realm, c.id))!
              .valueJson,
          )
        : null,
    })),
  };
}
export async function saveQuickbooksMapping(actor: string, raw: unknown) {
  const input = inputSchema.parse(raw);
  await financeAccess(prisma, actor, true);
  const currentConfig = await quickbooksConfig();
  const requestId =
      "qbo_map_" +
      createHash("sha256")
        .update(actor + ":" + input.requestKey)
        .digest("hex"),
    fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const replay = (value: Prisma.JsonValue) => {
    const prior = z
      .object({ fingerprint: z.string(), mapping: quickbooksMappingSchema })
      .parse(value);
    if (
      prior.mapping.mode !== currentConfig.mode ||
      prior.mapping.realm !== currentConfig.realm ||
      prior.fingerprint !== fingerprint
    )
      throw new AccountError(
        "This mapping request was already used for different choices.",
        409,
      );
    return prior.mapping;
  };
  const previous = await prisma.auditLog.findUnique({ where: { id: requestId } });
  if (previous) return replay(previous.afterJson!);
  const snapshot = await authorizedQuickbooks(actor);
  const [expense, payment] = await Promise.all([
    readQuickbooksAccount(snapshot.config, snapshot.accessToken, input.expenseAccountId),
    readQuickbooksAccount(snapshot.config, snapshot.accessToken, input.paymentAccountId),
  ]);
  if (
    expense.Id !== input.expenseAccountId ||
    payment.Id !== input.paymentAccountId ||
    !expense.Active ||
    !payment.Active ||
    !["Expense", "Other Expense"].includes(expense.AccountType) ||
    !["Bank", "Credit Card"].includes(payment.AccountType) ||
    expense.CurrencyRef?.value !== "USD" ||
    payment.CurrencyRef?.value !== "USD" ||
    expense.Id === payment.Id
  )
    throw new AccountError(
      "Choose active USD expense and bank or credit-card accounts from the intended company.",
      409,
    );
  if ((await quickbooksConfig()).fingerprint !== snapshot.config.fingerprint)
    throw new AccountError("QuickBooks settings changed. Reload the accounts.", 409);
  const key = mappingKey(snapshot.config.mode, snapshot.config.realm, input.categoryId);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const prior = await tx.auditLog.findUnique({ where: { id: requestId } });
    if (prior) return replay(prior.afterJson!);
    if (!(await tx.expenseCategory.findUnique({ where: { id: input.categoryId } })))
      throw new AccountError("Expense category no longer exists.", 404);
    const row = await tx.setting.findUnique({ where: { key } }),
      before = row ? quickbooksMappingSchema.parse(row.valueJson) : null;
    if ((before?.version ?? 0) !== input.version)
      throw new AccountError("This mapping changed. Reload before saving.", 409);
    const mapping = quickbooksMappingSchema.parse({
      version: input.version + 1,
      mode: snapshot.config.mode,
      realm: snapshot.config.realm,
      categoryId: input.categoryId,
      expenseAccount: {
        id: expense.Id,
        name: expense.Name,
        type: expense.AccountType,
        currency: "USD",
      },
      paymentAccount: {
        id: payment.Id,
        name: payment.Name,
        type: payment.AccountType,
        currency: "USD",
      },
      verifiedAt: new Date().toISOString(),
    });
    await tx.setting.upsert({
      where: { key },
      create: { key, valueJson: json(mapping) },
      update: { valueJson: json(mapping) },
    });
    await tx.auditLog.create({
      data: {
        id: requestId,
        actorUserId: actor,
        action: "quickbooks.mapping.saved",
        entityType: "ExpenseCategory",
        entityId: input.categoryId,
        beforeJson: before ? json(before) : undefined,
        afterJson: json({ fingerprint, mapping }),
      },
    });
    return mapping;
  });
}
