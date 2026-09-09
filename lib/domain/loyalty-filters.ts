import { z } from "zod";
import type { Prisma } from "@prisma/client";

const common = {
  q: z.string().trim().max(100).default(""),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
};
export const referralFilterSchema = z.object({
  ...common,
  status: z.enum(["ALL", "PENDING", "REWARDED", "REVERSED"]).default("ALL"),
});
export const rewardsFilterSchema = z.object({
  ...common,
  kind: z.enum(["ALL", "REFERRAL", "REDEMPTION", "REVERSAL", "RESTORE"]).default("ALL"),
});
export function referralWhere({
  status,
  q,
}: z.infer<typeof referralFilterSchema>): Prisma.ReferralWhereInput {
  return {
    linkId: { not: null },
    ...(status === "ALL" ? {} : { status }),
    ...(q
      ? {
          OR: [
            { id: { contains: q } },
            { referrer: { user: { email: { contains: q, mode: "insensitive" } } } },
            { referee: { user: { email: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}
export function rewardsWhere({
  kind,
  q,
}: z.infer<typeof rewardsFilterSchema>): Prisma.RewardEntryWhereInput {
  return {
    ...(kind === "ALL" ? {} : { kind }),
    ...(q ? { customer: { user: { email: { contains: q, mode: "insensitive" } } } } : {}),
  };
}
export function loyaltyOrder(sort: "newest" | "oldest") {
  const direction = sort === "oldest" ? ("asc" as const) : ("desc" as const);
  return [{ createdAt: direction }, { id: direction }];
}
