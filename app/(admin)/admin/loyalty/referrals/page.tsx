import Link from "next/link";
import {
  referralFilterSchema,
  referralWhere,
  loyaltyOrder,
} from "@/lib/domain/loyalty-filters";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { ReviewReferral } from "@/components/loyalty/admin";
import { Card } from "@/components/ui/card";
import { formatCents } from "@/lib/domain/money";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("ADMIN", "SUPER_ADMIN");
  const search = await searchParams;
  const parsed = referralFilterSchema.safeParse(search);
  if (!parsed.success)
    return (
      <p>
        Invalid filters. <Link href="/admin/loyalty/referrals">Clear filters</Link>
      </p>
    );
  const { status, q, page, sort } = parsed.data;
  const where = referralWhere(parsed.data);
  const [rows, count] = await Promise.all([
    prisma.referral.findMany({
      where,
      orderBy: loyaltyOrder(sort),
      skip: (page - 1) * 25,
      take: 25,
      include: {
        referrer: { include: { user: { select: { email: true } } } },
        referee: { include: { user: { select: { email: true } } } },
      },
    }),
    prisma.referral.count({ where }),
  ]);
  const query = new URLSearchParams({ status, q, sort });
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/admin/loyalty">← Loyalty program</Link>
      <h1 className="text-3xl font-semibold">Referral activity</h1>
      <form className="grid gap-3 sm:grid-cols-4">
        <label>
          Lookup
          <input
            name="q"
            defaultValue={q}
            className="mt-1 w-full rounded-xl border p-3"
            placeholder="Referral ID or account email"
          />
        </label>
        <label>
          Status
          <select
            name="status"
            defaultValue={status}
            className="mt-1 w-full rounded-xl border p-3"
          >
            {["ALL", "PENDING", "REWARDED", "REVERSED"].map((v) => (
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
        {count} matching referrals · {sort === "newest" ? "newest first" : "oldest first"}
      </p>
      <a
        className="inline-block rounded-full border border-teal-200 px-4 py-2"
        href={`/api/admin/loyalty/export?scope=referrals&${query}`}
      >
        Export filtered CSV
      </a>
      {rows.map((r) => (
        <Card key={r.id} className="space-y-3">
          <h2 className="font-semibold break-all">
            {r.referrer.user.email} → {r.referee.user.email}
          </h2>
          <p>
            {r.status} · Referrer {formatCents(r.creditCents)} · Friend{" "}
            {formatCents(r.friendCreditCents)}
          </p>
          <p className="text-xs break-all">{r.id}</p>
          <ReviewReferral id={r.id} />
        </Card>
      ))}
      {!rows.length && <Card>No matching referrals.</Card>}
      <nav className="flex justify-between">
        {page > 1 && (
          <Link href={`/admin/loyalty/referrals?${query}&page=${page - 1}`}>
            Previous
          </Link>
        )}
        {page * 25 < count && (
          <Link href={`/admin/loyalty/referrals?${query}&page=${page + 1}`}>Next</Link>
        )}
      </nav>
    </div>
  );
}
