import { z } from "zod";
import { accountRequest, accountFailure } from "@/lib/account-api";
import { AccountError, csvCell } from "@/lib/domain/account";
import {
  referralFilterSchema,
  referralWhere,
  rewardsFilterSchema,
  rewardsWhere,
  loyaltyOrder,
} from "@/lib/domain/loyalty-filters";
import { loyaltyAdmin } from "@/lib/services/loyalty";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    await loyaltyAdmin(prisma, await accountRequest());
    const search = Object.fromEntries(new URL(request.url).searchParams);
    const scope = z.enum(["referrals", "rewards"]).parse(search.scope);
    let rows: unknown[][];
    if (scope === "referrals") {
      const filters = referralFilterSchema.parse(search);
      const entries = await prisma.referral.findMany({
        where: referralWhere(filters),
        orderBy: loyaltyOrder(filters.sort),
        take: 10001,
        select: {
          id: true,
          status: true,
          creditCents: true,
          friendCreditCents: true,
          createdAt: true,
          referrer: { select: { user: { select: { email: true } } } },
          referee: { select: { user: { select: { email: true } } } },
        },
      });
      if (entries.length > 10000)
        throw new AccountError("Narrow your filters to export 10,000 or fewer records.");
      rows = [
        [
          "Referral ID",
          "Referrer",
          "Friend",
          "Status",
          "Referrer reward (USD cents)",
          "Friend reward (USD cents)",
          "Created (UTC)",
        ],
        ...entries.map((r) => [
          r.id,
          r.referrer.user.email,
          r.referee.user.email,
          r.status,
          r.creditCents,
          r.friendCreditCents,
          r.createdAt.toISOString(),
        ]),
      ];
    } else {
      const filters = rewardsFilterSchema.parse(search);
      const entries = await prisma.rewardEntry.findMany({
        where: rewardsWhere(filters),
        orderBy: loyaltyOrder(filters.sort),
        take: 10001,
        select: {
          id: true,
          kind: true,
          amountCents: true,
          description: true,
          createdAt: true,
          customer: { select: { user: { select: { email: true } } } },
        },
      });
      if (entries.length > 10000)
        throw new AccountError("Narrow your filters to export 10,000 or fewer records.");
      rows = [
        [
          "Entry ID",
          "Account",
          "Type",
          "Amount (USD cents)",
          "Description",
          "Created (UTC)",
        ],
        ...entries.map((r) => [
          r.id,
          r.customer.user.email,
          r.kind,
          r.amountCents,
          r.description,
          r.createdAt.toISOString(),
        ]),
      ];
    }
    return new Response(rows.map((row) => row.map(csvCell).join(",")).join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="loyalty-${scope}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return accountFailure(e);
  }
}
