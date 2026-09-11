import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { financeAccess } from "./finance";
import { authorizedQuickbooks, assertQuickbooksSnapshot } from "./quickbooks-connection";
import {
  quickbooksConfig,
  readQuickbooksSalesEntity,
  readQuickbooksSalesEntities,
  readQuickbooksAccount,
} from "@/lib/integrations/quickbooks-client";
export const salesMappingKind = z.enum(["customer", "item"]);
const numeric = z.string().regex(/^\d{1,30}$/);
export const salesMappingSchema = z
  .object({
    version: z.number().int().positive(),
    kind: salesMappingKind,
    sourceId: z.string().min(1).max(100),
    mode: z.enum(["sandbox", "live"]),
    realm: numeric,
    externalId: numeric,
    externalName: z.string(),
    incomeAccountId: numeric.nullable(),
    verifiedAt: z.string().datetime(),
  })
  .strict();
export const salesMappingKey = (mode: string, realm: string, kind: string, id: string) =>
  `quickbooks:sales-map:v1:${mode}:${realm}:${kind}:${id}`;
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
async function sourceExists(
  tx: Prisma.TransactionClient,
  kind: z.infer<typeof salesMappingKind>,
  id: string,
) {
  const row =
    kind === "customer"
      ? await tx.customer.findUnique({ where: { id }, select: { id: true } })
      : await tx.productVariant.findUnique({ where: { id }, select: { id: true } });
  if (!row)
    throw new AccountError("The selected application record no longer exists.", 404);
}
export async function salesMappingSources(actor: string, raw: unknown) {
  const input = z
    .object({ kind: salesMappingKind, cursor: z.string().min(1).max(100).optional() })
    .strict()
    .parse(raw);
  const canWrite = await financeAccess(prisma, actor),
    config = await quickbooksConfig();
  const paging = {
    take: 51,
    orderBy: { id: "asc" as const },
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  };
  const sources =
    input.kind === "customer"
      ? (
          await prisma.customer.findMany({
            ...paging,
            select: {
              id: true,
              firstName: true,
              lastName: true,
              user: { select: { email: true } },
            },
          })
        ).map((r) => ({
          id: r.id,
          name:
            [r.firstName, r.lastName].filter(Boolean).join(" ") +
            " · " +
            (r.user.email ?? "No email"),
        }))
      : (
          await prisma.productVariant.findMany({
            ...paging,
            select: {
              id: true,
              name: true,
              sku: true,
              product: { select: { name: true } },
            },
          })
        ).map((r) => ({
          id: r.id,
          name: r.product.name + " · " + r.name + " · " + r.sku,
        }));
  const rows = sources.slice(0, 50),
    keys = rows.map((r) => salesMappingKey(config.mode, config.realm, input.kind, r.id));
  const settings = await prisma.setting.findMany({
    where: { key: { in: keys } },
    select: { key: true, valueJson: true },
  });
  return {
    canWrite,
    realm: config.realm,
    nextCursor: sources.length > 50 ? rows[49].id : null,
    rows: rows.map((r) => {
      const value = settings.find(
        (s) => s.key === salesMappingKey(config.mode, config.realm, input.kind, r.id),
      );
      return { ...r, mapping: value ? salesMappingSchema.parse(value.valueJson) : null };
    }),
  };
}
export async function salesProviderChoices(actor: string, raw: unknown) {
  const input = z
    .object({ kind: salesMappingKind, start: z.number().int().min(1).max(100001) })
    .strict()
    .parse(raw);
  const snapshot = await authorizedQuickbooks(actor);
  const result = await readQuickbooksSalesEntities(
    snapshot.config,
    snapshot.accessToken,
    input.kind,
    input.start,
  );
  if ((await quickbooksConfig()).fingerprint !== snapshot.config.fingerprint)
    throw new AccountError("QuickBooks settings changed. Reload the choices.", 409);
  await prisma.$transaction((tx) => assertQuickbooksSnapshot(tx, actor, snapshot));
  return { realm: snapshot.config.realm, ...result };
}
export async function saveSalesMapping(actor: string, raw: unknown) {
  const input = z
    .object({
      requestKey: z.uuid(),
      kind: salesMappingKind,
      sourceId: z.string().min(1).max(100),
      externalId: numeric,
      version: z.number().int().nonnegative(),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const config = await quickbooksConfig(),
    fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    id =
      "qbsm_" +
      createHash("sha256")
        .update(actor + ":" + input.requestKey)
        .digest("hex");
  const replay = (raw: unknown) => {
    const prior = z
      .object({ fingerprint: z.string(), mapping: salesMappingSchema })
      .parse(raw);
    if (
      prior.fingerprint !== fingerprint ||
      prior.mapping.mode !== config.mode ||
      prior.mapping.realm !== config.realm
    )
      throw new AccountError(
        "This request was already used for different mapping choices.",
        409,
      );
    return prior.mapping;
  };
  const prior = await prisma.auditLog.findUnique({ where: { id } });
  if (prior) return replay(prior.afterJson);
  const snapshot = await authorizedQuickbooks(actor);
  if (config.fingerprint !== snapshot.config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  const entity = await readQuickbooksSalesEntity(
    config,
    snapshot.accessToken,
    input.kind,
    input.externalId,
  );
  if (
    entity.kind !== input.kind ||
    entity.id !== input.externalId ||
    !entity.active ||
    (entity.kind === "customer" && entity.currency !== "USD") ||
    (entity.kind === "item" &&
      (!["NonInventory", "Service"].includes(entity.type) ||
        entity.tracksQuantity ||
        !entity.incomeAccountId))
  )
    throw new AccountError(
      "Choose an active USD customer or a non-inventory sales item with an income account.",
      409,
    );
  const incomeAccountId = entity.kind === "item" ? entity.incomeAccountId : null;
  if (incomeAccountId) {
    const account = await readQuickbooksAccount(
      config,
      snapshot.accessToken,
      incomeAccountId,
    );
    if (
      account.Id !== incomeAccountId ||
      !account.Active ||
      account.AccountType !== "Income" ||
      account.CurrencyRef?.value !== "USD"
    )
      throw new AccountError(
        "The sales item's income account must be active and use USD.",
        409,
      );
  }
  if ((await quickbooksConfig()).fingerprint !== config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    await sourceExists(tx, input.kind, input.sourceId);
    const prefix = `quickbooks:sales-map:v1:${config.mode}:${config.realm}:${input.kind}:`,
      key = salesMappingKey(config.mode, config.realm, input.kind, input.sourceId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${prefix},0))`;
    const prior = await tx.auditLog.findUnique({ where: { id } });
    if (prior) return replay(prior.afterJson);
    const row = await tx.setting.findUnique({ where: { key } }),
      before = row ? salesMappingSchema.parse(row.valueJson) : null;
    if ((before?.version ?? 0) !== input.version)
      throw new AccountError("This mapping changed. Reload before saving.", 409);
    if (
      await tx.setting.findFirst({
        where: {
          AND: [
            { key: { startsWith: prefix } },
            { key: { not: key } },
            { valueJson: { path: ["externalId"], equals: input.externalId } },
          ],
        },
        select: { key: true },
      })
    )
      throw new AccountError(
        "That QuickBooks record is already linked to another application record.",
        409,
      );
    const mapping = salesMappingSchema.parse({
      version: input.version + 1,
      kind: input.kind,
      sourceId: input.sourceId,
      mode: config.mode,
      realm: config.realm,
      externalId: entity.id,
      externalName: entity.name,
      incomeAccountId,
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
        action: "quickbooks.sales-mapping.saved",
        entityType: "QuickBooksSalesMapping",
        entityId: key,
        beforeJson: before ? json(before) : undefined,
        afterJson: json({ fingerprint, mapping }),
      },
    });
    return mapping;
  });
}
