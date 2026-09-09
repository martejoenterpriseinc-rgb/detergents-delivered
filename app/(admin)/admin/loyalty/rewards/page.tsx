import Link from "next/link";
import {
  rewardsFilterSchema,
  rewardsWhere,
  loyaltyOrder,
} from "@/lib/domain/loyalty-filters";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/card";
import { formatCents } from "@/lib/domain/money";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("ADMIN", "SUPER_ADMIN");
  const parsed = rewardsFilterSchema.safeParse(await searchParams);
  if (!parsed.success)
    return (
      <p>
        Invalid filters. <Link href="/admin/loyalty/rewards">Clear filters</Link>
      </p>
    );
  const { kind, q, page, sort } = parsed.data;
  const where = rewardsWhere(parsed.data);
  const [rows, count] = await Promise.all([
    prisma.rewardEntry.findMany({
      where,
      orderBy: loyaltyOrder(sort),
      skip: (page - 1) * 25,
      take: 25,
      include: { customer: { include: { user: { select: { email: true } } } } },
    }),
    prisma.rewardEntry.count({ where }),
  ]);
  const query = new URLSearchParams({ kind, q, sort });
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/admin/loyalty">← Loyalty program</Link>
      <h1 className="text-3xl font-semibold">Rewards ledger</h1>
      <p>
        Original entries are never edited or deleted. Corrections appear as new entries.
      </p>
      <form className="grid gap-3 sm:grid-cols-4">
        <label>
          Account lookup
          <input
            name="q"
            defaultValue={q}
            className="mt-1 w-full rounded-xl border p-3"
          />
        </label>
        <label>
          Entry type
          <select
            name="kind"
            defaultValue={kind}
            className="mt-1 w-full rounded-xl border p-3"
          >
            {["ALL", "REFERRAL", "REDEMPTION", "REVERSAL", "RESTORE"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select
            name="sort"
            defaultValue={sort}
            className="mt-1 w-full rounded-xl border p-3"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        <button className="self-end rounded-full bg-teal-700 p-3 text-white">
          Apply filters
        </button>
      </form>
      <p>
        {count} matching entries · {sort === "newest" ? "newest first" : "oldest first"}
      </p>
      <a
        className="inline-block rounded-full border border-teal-200 px-4 py-2"
        href={`/api/admin/loyalty/export?scope=rewards&${query}`}
      >
        Export filtered CSV
      </a>
      {rows.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap justify-between gap-3">
            <h2 className="font-semibold break-all">{r.customer.user.email}</h2>
            <strong>{formatCents(r.amountCents)}</strong>
          </div>
          <p className="mt-2">{r.description}</p>
          <p className="mt-2 text-xs">
            {new Intl.DateTimeFormat("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "America/Chicago",
            }).format(r.createdAt)}{" "}
            Central · {r.kind}
          </p>
        </Card>
      ))}
      {!rows.length && <Card>No matching entries.</Card>}
      <nav className="flex justify-between">
        {page > 1 && (
          <Link href={`/admin/loyalty/rewards?${query}&page=${page - 1}`}>Previous</Link>
        )}
        {page * 25 < count && (
          <Link href={`/admin/loyalty/rewards?${query}&page=${page + 1}`}>Next</Link>
        )}
      </nav>
    </div>
  );
}
