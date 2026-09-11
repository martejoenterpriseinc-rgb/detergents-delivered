import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { financeAccess } from "./finance";
import { AccountError } from "@/lib/domain/account";
import { costMappingSchema } from "@/lib/domain/quickbooks-cost";
import {
  quickbooksConfig,
  readQuickbooksAccount,
} from "@/lib/integrations/quickbooks-client";
import { authorizedQuickbooks, assertQuickbooksSnapshot } from "./quickbooks-connection";
export const costMappingKey = (mode: string, realm: string) =>
  `quickbooks:cost-map:v1:${mode}:${realm}`;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function costMappingData(actor: string) {
  const canWrite = await financeAccess(prisma, actor);
  const c = await quickbooksConfig(),
    row = await prisma.setting.findUnique({
      where: { key: costMappingKey(c.mode, c.realm) },
    });
  return {
    canWrite,
    realm: c.realm,
    mapping: row ? costMappingSchema.parse(row.valueJson) : null,
  };
}
export async function saveCostMapping(actor: string, raw: unknown) {
  const input = z
    .object({
      requestKey: z.uuid(),
      costAccountId: z.string().regex(/^\d{1,30}$/),
      inventoryAccountId: z.string().regex(/^\d{1,30}$/),
      version: z.number().int().nonnegative(),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const config = await quickbooksConfig(),
    fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    id =
      "qbcm_" +
      createHash("sha256")
        .update(actor + ":" + input.requestKey)
        .digest("hex");
  const replay = (raw: unknown) => {
    const prior = z
      .object({ fingerprint: z.string(), mapping: costMappingSchema })
      .parse(raw);
    if (
      prior.fingerprint !== fingerprint ||
      prior.mapping.mode !== config.mode ||
      prior.mapping.realm !== config.realm
    )
      throw new AccountError(
        "This mapping request was already used for different choices.",
        409,
      );
    return prior.mapping;
  };
  const prior = await prisma.auditLog.findUnique({ where: { id } });
  if (prior) return replay(prior.afterJson);
  const snapshot = await authorizedQuickbooks(actor);
  if (snapshot.config.fingerprint !== config.fingerprint)
    throw new AccountError("QuickBooks settings changed. Reload before saving.", 409);
  const [cost, inventory] = await Promise.all([
    readQuickbooksAccount(snapshot.config, snapshot.accessToken, input.costAccountId),
    readQuickbooksAccount(
      snapshot.config,
      snapshot.accessToken,
      input.inventoryAccountId,
    ),
  ]);
  if (
    cost.Id !== input.costAccountId ||
    inventory.Id !== input.inventoryAccountId ||
    cost.Id === inventory.Id ||
    !cost.Active ||
    !inventory.Active ||
    cost.AccountType !== "Cost of Goods Sold" ||
    inventory.AccountType !== "Other Current Asset" ||
    cost.CurrencyRef?.value !== "USD" ||
    inventory.CurrencyRef?.value !== "USD"
  )
    throw new AccountError(
      "Select active USD cost-of-goods and inventory-asset accounts from the intended company.",
      409,
    );
  if ((await quickbooksConfig()).fingerprint !== snapshot.config.fingerprint)
    throw new AccountError("QuickBooks settings changed.", 409);
  return prisma.$transaction(async (tx) => {
    await assertQuickbooksSnapshot(tx, actor, snapshot, true);
    const key = costMappingKey(config.mode, config.realm);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const previous = await tx.auditLog.findUnique({ where: { id } });
    if (previous) return replay(previous.afterJson);
    const row = await tx.setting.findUnique({ where: { key } }),
      before = row ? costMappingSchema.parse(row.valueJson) : null;
    if ((before?.version ?? 0) !== input.version)
      throw new AccountError("Cost account mapping changed. Reload before saving.", 409);
    const mapping = costMappingSchema.parse({
      version: input.version + 1,
      mode: config.mode,
      realm: config.realm,
      costAccount: {
        id: cost.Id,
        name: cost.Name,
        type: cost.AccountType,
        currency: "USD",
      },
      inventoryAccount: {
        id: inventory.Id,
        name: inventory.Name,
        type: inventory.AccountType,
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
        id,
        actorUserId: actor,
        action: "quickbooks.cost-mapping.saved",
        entityType: "QuickBooksCostMapping",
        entityId: key,
        beforeJson: before ? json(before) : undefined,
        afterJson: json({ fingerprint, mapping }),
      },
    });
    return mapping;
  });
}
