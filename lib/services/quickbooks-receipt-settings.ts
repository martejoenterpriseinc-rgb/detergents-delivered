import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { financeAccess } from "./finance";
import { AccountError } from "@/lib/domain/account";
import {
  quickbooksConfig,
  readQuickbooksAccount,
  readQuickbooksReceiptCompany,
} from "@/lib/integrations/quickbooks-client";
import { authorizedQuickbooks, assertQuickbooksSnapshot } from "./quickbooks-connection";
const numeric = z.string().regex(/^\d{1,30}$/);
export const receiptSettingsSchema = z
  .object({
    version: z.number().int().positive(),
    mode: z.enum(["sandbox", "live"]),
    realm: numeric,
    depositAccount: z
      .object({
        id: numeric,
        name: z.string(),
        type: z.literal("Bank"),
        currency: z.literal("USD"),
      })
      .strict(),
    company: z
      .object({
        country: z.literal("US"),
        homeCurrency: z.literal("USD"),
        usingSalesTax: z.literal(true),
        partnerTaxEnabled: z.boolean().nullable(),
      })
      .strict(),
    verifiedAt: z.string().datetime(),
  })
  .strict();
export const receiptSettingsKey = (mode: string, realm: string) =>
  `quickbooks:receipt-map:v1:${mode}:${realm}`;
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
export async function receiptSettingsData(actor: string) {
  const canWrite = await financeAccess(prisma, actor),
    c = await quickbooksConfig();
  const row = await prisma.setting.findUnique({
    where: { key: receiptSettingsKey(c.mode, c.realm) },
  });
  return {
    canWrite,
    realm: c.realm,
    mapping: row ? receiptSettingsSchema.parse(row.valueJson) : null,
  };
}
export async function saveReceiptSettings(actor: string, raw: unknown) {
  const input = z
    .object({
      requestKey: z.uuid(),
      depositAccountId: numeric,
      version: z.number().int().nonnegative(),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const config = await quickbooksConfig(),
    fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    id =
      "qbrm_" +
      createHash("sha256")
        .update(actor + ":" + input.requestKey)
        .digest("hex");
  const replay = (raw: unknown) => {
    const prior = z
      .object({ fingerprint: z.string(), mapping: receiptSettingsSchema })
      .parse(raw);
    if (
      prior.fingerprint !== fingerprint ||
      prior.mapping.mode !== config.mode ||
      prior.mapping.realm !== config.realm
    )
      throw new AccountError(
        "This receipt settings request was used for different choices.",
        409,
      );
    return prior.mapping;
  };
  const previous = await prisma.auditLog.findUnique({ where: { id } });
  if (previous) return replay(previous.afterJson);
  const snapshot = await authorizedQuickbooks(actor);
  if (snapshot.config.fingerprint !== config.fingerprint)
    throw new AccountError("QuickBooks settings changed. Reload before saving.", 409);
  const [account, company] = await Promise.all([
    readQuickbooksAccount(snapshot.config, snapshot.accessToken, input.depositAccountId),
    readQuickbooksReceiptCompany(snapshot.config, snapshot.accessToken),
  ]);
  if (
    account.Id !== input.depositAccountId ||
    !account.Active ||
    account.AccountType !== "Bank" ||
    account.CurrencyRef?.value !== "USD"
  )
    throw new AccountError(
      "Choose an active USD bank-type clearing account in the intended company.",
      409,
    );
  if (
    company.country !== "US" ||
    company.homeCurrency !== "USD" ||
    !company.usingSalesTax
  )
    throw new AccountError(
      "Receipt settings require a US company with USD home currency and sales tax enabled.",
      409,
    );
  if ((await quickbooksConfig()).fingerprint !== snapshot.config.fingerprint)
    throw new AccountError("QuickBooks settings changed. Reload before saving.", 409);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    const key = receiptSettingsKey(config.mode, config.realm);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const previous = await tx.auditLog.findUnique({ where: { id } });
    if (previous) return replay(previous.afterJson);
    const row = await tx.setting.findUnique({ where: { key } }),
      before = row ? receiptSettingsSchema.parse(row.valueJson) : null;
    if ((before?.version ?? 0) !== input.version)
      throw new AccountError("Receipt settings changed. Reload before saving.", 409);
    const mapping = receiptSettingsSchema.parse({
      version: input.version + 1,
      mode: config.mode,
      realm: config.realm,
      depositAccount: {
        id: account.Id,
        name: account.Name,
        type: account.AccountType,
        currency: "USD",
      },
      company,
      verifiedAt: new Date().toISOString(),
    });
    await tx.setting.upsert({
      where: { key },
      create: { key, valueJson: json(mapping) },
      update: { valueJson: json(mapping) },
    });
    await tx.auditLog.create({
      data: {
        id,
        actorUserId: actor,
        action: "quickbooks.receipt-settings.saved",
        entityType: "QuickBooksReceiptSettings",
        entityId: key,
        beforeJson: before ? json(before) : undefined,
        afterJson: json({ fingerprint, mapping }),
      },
    });
    return mapping;
  });
}
