import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { promotionSchema, discountForPromotion } from "@/lib/domain/promotions";
import { businessDate } from "@/lib/domain/operations";
import { accountIdentity } from "./customer-account";

export async function savePromotion(userId: string, input: unknown) {
  const data = promotionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const user = await accountIdentity(tx, userId, true);
    if (!user.userRoles.some(({ role }) => ["ADMIN", "SUPER_ADMIN"].includes(role.code)))
      throw new AccountError("Administrator access required.", 403);
    // Transaction-wide lock serializes the unique code across administrators.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(613279104)`;
    const before = await tx.promotion.findUnique({ where: { code: data.code } });
    if ((before?.version ?? 0) !== data.version)
      throw new AccountError("Promotion changed. Refresh before saving.", 409);
    const fields = {
      ...data,
      version: data.version + 1,
      startsAt: new Date(data.startsOn),
      endsAt: new Date(`${data.endsOn}T23:59:59.999Z`),
    };
    const saved = await tx.promotion.upsert({
      where: { code: data.code },
      create: fields,
      update: fields,
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "promotion.saved",
        entityType: "Promotion",
        entityId: saved.id,
        afterJson: { ...data, version: saved.version },
      },
    });
    return saved;
  });
}
export async function quotePromotion(
  db: Prisma.TransactionClient,
  customerId: string,
  code: string | undefined,
  merchandiseCents: number,
) {
  if (!code) return { discountCents: 0, allowRewards: true, promotion: null };
  const p = await db.promotion.findUnique({ where: { code: code.toUpperCase() } });
  if (!p?.startsOn || !p.endsOn || p.maxRedemptions !== null)
    throw new AccountError("Promotion is unavailable or needs review.", 409);
  const [orders, referral] = await Promise.all([
    db.order.count({
      where: { customerId, status: { notIn: ["DRAFT", "CANCELLED", "PENDING_PAYMENT"] } },
    }),
    db.referral.findUnique({ where: { refereeId: customerId } }),
  ]);
  try {
    const terms = promotionSchema.parse({
      code: p.code,
      name: p.name,
      value: p.value,
      valueType: p.valueType,
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      minimumPurchaseCents: p.minimumPurchaseCents,
      maximumDiscountCents: p.maximumDiscountCents,
      audience: p.audience,
      allowRewards: p.allowRewards,
      isActive: p.isActive,
      version: p.version,
    });
    return {
      discountCents: discountForPromotion(terms, merchandiseCents, businessDate(), {
        hasPriorOrder: orders > 0,
        referred: Boolean(referral && referral.status !== "REVERSED"),
      }),
      allowRewards: p.allowRewards,
      promotion: { id: p.id, ...terms },
    };
  } catch (error) {
    throw new AccountError(
      error instanceof Error ? error.message : "Promotion cannot be applied.",
      409,
    );
  }
}
