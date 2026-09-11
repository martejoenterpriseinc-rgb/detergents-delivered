import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { AccountError } from "@/lib/domain/account";
import { allocateCents } from "@/lib/commerce/domain";

const snapshot = z.object({
  rewardsCents: z.number().int().nonnegative(),
  promotionCents: z.number().int().nonnegative(),
  lines: z
    .array(
      z.object({
        variantId: z.string(),
        quantity: z.number().int().positive(),
        discountCents: z.number().int().nonnegative(),
        netCents: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

/** Allocate only the original redeemed credit across the saved combined discount.
 * Historical snapshot order resolves integer remainders; current prices are irrelevant.
 */
export async function refundRewardAmounts(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: true,
      rewardReservation: true,
      checkoutAttempt: true,
    },
  });
  const hold = order.rewardReservation;
  if (!hold?.amountCents) return new Map(order.items.map((i) => [i.id, 0]));
  const fail = () =>
    new AccountError("Saved reward redemption requires reconciliation.", 409);
  if (
    hold.state !== "USED" ||
    hold.customerId !== order.customerId ||
    !order.checkoutAttempt
  )
    throw fail();
  const parsed = snapshot.safeParse(order.checkoutAttempt.snapshot);
  if (!parsed.success) throw fail();
  const saved = parsed.data;
  const used = await tx.rewardEntry.findUnique({
    where: { entryKey: `order:${orderId}:use` },
  });
  if (
    !used ||
    used.customerId !== order.customerId ||
    used.orderId !== orderId ||
    used.sourceId !== hold.id ||
    used.kind !== "REDEMPTION" ||
    used.amountCents !== -hold.amountCents ||
    saved.rewardsCents !== hold.amountCents ||
    saved.lines.length !== order.items.length ||
    new Set(saved.lines.map((l) => l.variantId)).size !== saved.lines.length ||
    saved.lines.reduce((s, l) => s + l.discountCents, 0) !==
      saved.rewardsCents + saved.promotionCents
  )
    throw fail();
  const amounts = allocateCents(
    saved.rewardsCents,
    saved.lines.map((l) => l.discountCents),
  );
  return new Map(
    saved.lines.map((line, index) => {
      const item = order.items.find((i) => i.productVariantId === line.variantId);
      if (
        !item ||
        item.quantity !== line.quantity ||
        item.discountCents !== line.discountCents ||
        item.lineTotalCents - item.taxCents !== line.netCents
      )
        throw fail();
      return [item.id, amounts[index]];
    }),
  );
}
