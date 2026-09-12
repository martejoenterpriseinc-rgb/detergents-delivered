import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { customerIdentity } from "./customer-account";

const cents = z.number().int().min(0).max(100_000_000);
const snapshotSchema = z.object({
  address: z.object({
    line1: z.string().min(1).max(300),
    line2: z.string().max(300).optional(),
    city: z.string().min(1).max(150),
    region: z.string().min(1).max(100),
    postalCode: z.string().min(1).max(30),
    country: z.literal("US"),
  }),
  subtotalCents: cents,
  promotionCents: cents,
  rewardsCents: cents,
  taxCents: cents,
  totalCents: cents,
  lines: z
    .array(
      z.object({
        variantId: z.string(),
        name: z.string().min(1).max(500),
        sku: z.string().max(200),
        quantity: z.number().int().min(1).max(100),
        unitPriceCents: cents,
        discountCents: cents,
        netCents: cents,
      }),
    )
    .min(1)
    .max(30),
});
const unavailable = () =>
  new AccountError(
    "This receipt needs support review. No financial records were changed.",
    409,
  );

/** Original purchase only: never recalculates prices/tax or calls a provider. */
export async function customerReceipt(userId: string, checkoutId: string) {
  return prisma.$transaction(
    async (tx) => {
      const { customer } = await customerIdentity(tx, userId);
      const a = await tx.checkoutAttempt.findFirst({
        where: { id: checkoutId, customerId: customer.id },
        include: {
          manualSettlement: true,
          order: { include: { items: true, payments: { include: { events: true } } } },
        },
      });
      if (!a) throw new AccountError("Receipt not found.", 404);
      const o = a.order;
      if (
        !["PAID", "REFUNDED"].includes(a.state) ||
        !o ||
        o.customerId !== customer.id ||
        !o.placedAt ||
        o.currency !== "USD" ||
        o.shippingCents !== 0
      )
        throw unavailable();
      const parsed = snapshotSchema.safeParse(a.snapshot);
      if (!parsed.success) throw unavailable();
      const s = parsed.data;
      const manual = a.paymentMethod !== "STRIPE";
      const r = a.manualSettlement;
      if (
        manual &&
        (!r ||
          r.state !== "SETTLED" ||
          r.method !== a.paymentMethod ||
          r.amountCents !== s.totalCents ||
          r.accountId !== a.stripeAccountId ||
          r.livemode !== a.livemode ||
          !r.taxTransactionId ||
          !r.taxEvidence)
      )
        throw unavailable();
      const payments = o.payments.filter(
        (p) =>
          p.provider === (manual ? "MANUAL" : "STRIPE") &&
          (!manual ||
            (p.externalId === r!.id &&
              p.events.some((e) => e.type === "manual.payment.settled"))) &&
          ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status) &&
          p.currency === "USD" &&
          p.amountCents === s.totalCents &&
          p.events.some((e) => e.externalId === `checkout:${a.id}:paid` && e.verifiedAt),
      );
      if (
        payments.length !== 1 ||
        o.subtotalCents !== s.subtotalCents ||
        o.discountCents !== s.promotionCents + s.rewardsCents ||
        o.taxCents !== s.taxCents ||
        o.totalCents !== s.totalCents ||
        s.subtotalCents - s.promotionCents - s.rewardsCents + s.taxCents !==
          s.totalCents ||
        new Set(s.lines.map((l) => l.variantId)).size !== s.lines.length ||
        o.items.length !== s.lines.length
      )
        throw unavailable();
      const lines = s.lines.map((l) => {
        const matches = o.items.filter((i) => i.productVariantId === l.variantId);
        const i = matches[0];
        if (
          matches.length !== 1 ||
          i.nameSnapshot !== l.name ||
          i.skuSnapshot !== l.sku ||
          i.quantity !== l.quantity ||
          i.unitPriceCents !== l.unitPriceCents ||
          i.discountCents !== l.discountCents ||
          l.unitPriceCents * l.quantity - l.discountCents !== l.netCents ||
          !Number.isSafeInteger(i.taxCents) ||
          i.taxCents < 0 ||
          i.lineTotalCents !== l.netCents + i.taxCents
        )
          throw unavailable();
        return {
          name: l.name,
          sku: l.sku,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountCents: l.discountCents,
          netCents: l.netCents,
          taxCents: i.taxCents,
          totalCents: i.lineTotalCents,
        };
      });
      if (
        lines.reduce((n, l) => n + l.quantity * l.unitPriceCents, 0) !==
          s.subtotalCents ||
        lines.reduce((n, l) => n + l.discountCents, 0) !==
          s.promotionCents + s.rewardsCents ||
        lines.reduce((n, l) => n + l.taxCents, 0) !== s.taxCents ||
        lines.reduce((n, l) => n + l.totalCents, 0) !== s.totalCents
      )
        throw unavailable();
      return {
        checkoutId: a.id,
        number: o.number,
        purchasedAt: o.placedAt.toISOString(),
        testReceipt: !a.livemode,
        address: s.address,
        lines,
        subtotalCents: s.subtotalCents,
        promotionCents: s.promotionCents,
        rewardsCents: s.rewardsCents,
        taxCents: s.taxCents,
        totalCents: s.totalCents,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
