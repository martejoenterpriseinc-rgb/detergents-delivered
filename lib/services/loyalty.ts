import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import {
  defaultProgram,
  loyaltyActionSchema,
  programSchema,
  rewardAllocation,
  rewardQuoteSchema,
} from "@/lib/domain/loyalty";
import { accountIdentity, customerIdentity } from "./customer-account";
import { pickCurrentPrice } from "@/lib/prices";
import { quotePromotion } from "./promotions";

export async function loyaltyAdmin(db: Prisma.TransactionClient, userId: string) {
  const user = await accountIdentity(db, userId);
  if (!user.userRoles.some(({ role }) => ["ADMIN", "SUPER_ADMIN"].includes(role.code)))
    throw new AccountError("Administrator access required.", 403);
}
export async function programConfig(db: Prisma.TransactionClient = prisma) {
  return (
    (await db.loyaltyProgram.findUnique({ where: { id: "default" } })) ?? defaultProgram
  );
}
export async function rewardBalance(db: Prisma.TransactionClient, customerId: string) {
  const [ledger, held] = await Promise.all([
    db.rewardEntry.aggregate({ where: { customerId }, _sum: { amountCents: true } }),
    db.rewardReservation.aggregate({
      where: { customerId, state: "HELD" },
      _sum: { amountCents: true },
    }),
  ]);
  const balanceCents = ledger._sum.amountCents ?? 0;
  const heldCents = held._sum.amountCents ?? 0;
  if (![balanceCents, heldCents].every(Number.isSafeInteger))
    throw new AccountError("Rewards need reconciliation.", 503);
  return {
    balanceCents,
    heldCents,
    availableCents: Math.max(0, balanceCents - heldCents),
  };
}
export async function getLoyalty(userId: string) {
  return prisma.$transaction(
    async (tx) => {
      const user = await accountIdentity(tx, userId);
      const config = await programConfig(tx);
      if (!user.customer || user.customer.deletedAt)
        return {
          config,
          customer: false,
          verified: false,
          balance: { balanceCents: 0, heldCents: 0, availableCents: 0 },
          links: [],
          entries: [],
          earnedCents: 0,
        };
      const customerId = user.customer.id;
      const [balance, links, entries, earned] = await Promise.all([
        rewardBalance(tx, customerId),
        tx.referralLink.findMany({
          where: { customerId },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            referral: {
              select: {
                status: true,
                creditCents: true,
                createdAt: true,
                redeemedAt: true,
              },
            },
          },
        }),
        tx.rewardEntry.findMany({
          where: { customerId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
          select: {
            id: true,
            kind: true,
            amountCents: true,
            description: true,
            createdAt: true,
            order: { select: { number: true, customerId: true } },
          },
        }),
        tx.rewardEntry.aggregate({
          where: { customerId, kind: "REFERRAL" },
          _sum: { amountCents: true },
        }),
      ]);
      return {
        config,
        customer: true,
        verified: Boolean(user.emailVerified),
        balance,
        links,
        entries: entries.map(({ order, ...item }) => ({
          ...item,
          order: order?.customerId === customerId ? { number: order.number } : null,
        })),
        earnedCents: earned._sum.amountCents ?? 0,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function updateProgram(userId: string, input: unknown) {
  const data = programSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loyaltyAdmin(tx, userId);
    await tx.loyaltyProgram.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
    });
    await tx.$queryRaw`SELECT id FROM "LoyaltyProgram" WHERE id = 'default' FOR UPDATE`;
    const before = await programConfig(tx);
    if (before.version !== data.version)
      throw new AccountError("Settings changed. Refresh before saving.", 409);
    const saved = await tx.loyaltyProgram.update({
      where: { id: "default" },
      data: { ...data, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "loyalty.settings.updated",
        entityType: "LoyaltyProgram",
        entityId: "default",
        beforeJson: JSON.parse(JSON.stringify(before)),
        afterJson: { ...data, version: saved.version },
      },
    });
    return saved;
  });
}
export async function loyaltyAction(userId: string, input: unknown) {
  const data = loyaltyActionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const { user, customer } = await customerIdentity(tx, userId, true);
    if (data.action === "shared") {
      const link = await tx.referralLink.findFirst({
        where: { id: data.id, customerId: customer.id },
      });
      if (!link) throw new AccountError("Referral link not found.", 404);
      const saved = await tx.referralLink.update({
        where: { id: link.id },
        data:
          data.method === "COPY"
            ? { copiedAt: link.copiedAt ?? new Date() }
            : { sharedAt: link.sharedAt ?? new Date() },
      });
      return { id: saved.id };
    }
    const config = await programConfig(tx);
    if (!config.enabled) throw new AccountError("The referral program is paused.", 409);
    if (!user.emailVerified)
      throw new AccountError(
        "Verify your account email before using referrals. Contact support if verification is unavailable.",
        403,
      );
    if (data.action === "create") {
      const existing = await tx.referralLink.findUnique({
        where: {
          customerId_requestKey: { customerId: customer.id, requestKey: data.requestKey },
        },
      });
      if (existing) {
        if (existing.label !== data.label)
          throw new AccountError(
            "This request was already used for a different link.",
            409,
          );
        return { id: existing.id };
      }
      if (
        (await tx.referralLink.count({
          where: {
            customerId: customer.id,
            createdAt: { gte: new Date(Date.now() - 3600000) },
          },
        })) >= 10
      )
        throw new AccountError("Please wait before creating more links.", 429);
      const link = await tx.referralLink.create({
        data: {
          customerId: customer.id,
          label: data.label,
          token: randomBytes(24).toString("hex"),
          requestKey: data.requestKey,
          expiresAt: new Date(Date.now() + config.linkExpiryDays * 86400000),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "referral.link.created",
          entityType: "ReferralLink",
          entityId: link.id,
        },
      });
      return { id: link.id };
    }
    const link = await tx.referralLink.findUnique({
      where: { token: data.token },
      include: { customer: { include: { user: true } } },
    });
    if (
      !link ||
      link.expiresAt <= new Date() ||
      link.customer.deletedAt ||
      link.customer.user.deletedAt
    )
      throw new AccountError("This referral link is unavailable or expired.", 404);
    if (
      link.customerId === customer.id ||
      link.customer.userId === userId ||
      (customer.phone && customer.phone === link.customer.phone)
    )
      throw new AccountError(
        "Self-referrals or matching contact numbers are not eligible.",
        409,
      );
    const prior = await tx.referral.findUnique({ where: { refereeId: customer.id } });
    if (prior) {
      if (prior.linkId === link.id) return { id: prior.id };
      throw new AccountError("A referral is already linked to your account.", 409);
    }
    if (
      await tx.order.count({
        where: { customerId: customer.id, status: { notIn: ["DRAFT", "CANCELLED"] } },
      })
    )
      throw new AccountError(
        "Referrals must be claimed before your first purchase.",
        409,
      );
    // Lock the link to allow at most one new customer per invitation, including simultaneous claims.
    await tx.$queryRaw`SELECT id FROM "ReferralLink" WHERE id = ${link.id} FOR UPDATE`;
    if (await tx.referral.findUnique({ where: { linkId: link.id } }))
      throw new AccountError("This invitation has already been claimed.", 409);
    const referral = await tx.referral.create({
      data: {
        referrerId: link.customerId,
        refereeId: customer.id,
        code: link.token,
        linkId: link.id,
        creditCents: config.referrerRewardCents,
        friendCreditCents: config.friendRewardCents,
        minimumPurchaseCents: config.minimumPurchaseCents,
        programVersion: config.version,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "referral.claimed",
        entityType: "Referral",
        entityId: referral.id,
      },
    });
    return { id: referral.id };
  });
}
export async function publicReferral(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const config = await programConfig();
  if (!config.enabled) return null;
  const link = await prisma.referralLink.findFirst({
    where: {
      token,
      expiresAt: { gt: new Date() },
      customer: { deletedAt: null, user: { deletedAt: null } },
      referral: null,
    },
    select: { expiresAt: true },
  });
  return link
    ? {
        expiresAt: link.expiresAt,
        friendRewardCents: config.friendRewardCents,
        minimumPurchaseCents: config.minimumPurchaseCents,
      }
    : null;
}
export async function quoteCartRewards(userId: string, input: unknown) {
  const { lines, promotionCode, applyRewards } = rewardQuoteSchema.parse(input);
  if (new Set(lines.map((l) => l.variantId)).size !== lines.length)
    throw new AccountError("Duplicate cart lines.");
  return prisma.$transaction(
    async (tx) => {
      const { customer } = await customerIdentity(tx, userId);
      const variants = await tx.productVariant.findMany({
        where: {
          id: { in: lines.map((l) => l.variantId) },
          deletedAt: null,
          isActive: true,
          websiteVisible: true,
          product: { deletedAt: null, isActive: true, websiteVisible: true },
        },
        include: {
          prices: {
            where: {
              kind: { in: ["RETAIL", "SALE"] },
              currency: "USD",
              startsAt: { lte: new Date() },
              OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
            },
            orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          },
        },
      });
      let merchandiseCents = 0;
      for (const line of lines) {
        const variant = variants.find((v) => v.id === line.variantId);
        const selling =
          variant &&
          (pickCurrentPrice(variant.prices, new Date(), "SALE") ??
            pickCurrentPrice(variant.prices));
        if (!selling || selling.amountCents <= 0)
          throw new AccountError(
            "A cart product is unavailable. Refresh your cart.",
            409,
          );
        merchandiseCents += selling.amountCents * line.quantity;
        if (!Number.isSafeInteger(merchandiseCents) || merchandiseCents > 100000000)
          throw new AccountError("Cart amount exceeds the supported limit.");
      }
      const balance = await rewardBalance(tx, customer.id);
      const promotion = await quotePromotion(
        tx,
        customer.id,
        promotionCode,
        merchandiseCents,
      );
      const canUseRewards = applyRewards && promotion.allowRewards;
      const allocation = rewardAllocation(
        canUseRewards ? balance.availableCents : 0,
        merchandiseCents - promotion.discountCents,
      );
      return {
        ...allocation,
        remainingCents: balance.availableCents - allocation.appliedCents,
        discountCents: promotion.discountCents,
        promotion: promotion.promotion,
        rewardsAllowed: promotion.allowRewards,
        availableCents: balance.availableCents,
        merchandiseCents,
        previewOnly: true as const,
        message:
          "Preview only. Final prices, tax and delivery availability are confirmed at checkout. No rewards have been used or reserved.",
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
