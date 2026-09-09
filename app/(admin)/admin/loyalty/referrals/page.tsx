import Link from "next/link";
import { z } from "zod";
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
  const parsed = z
    .object({
      status: z.enum(["ALL", "PENDING", "REWARDED", "REVERSED"]).default("ALL"),
      q: z.string().trim().max(100).default(""),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    })
    .safeParse(search);
  if (!parsed.success)
    return (
      <p>
        Invalid filters. <Link href="/admin/loyalty/referrals">Clear filters</Link>
      </p>
    );
  const { status, q, page } = parsed.data;
  const where = {
    linkId: { not: null },
    ...(status === "ALL" ? {} : { status }),
    ...(q
      ? {
          OR: [
            { id: { contains: q } },
            {
              referrer: {
                user: { email: { contains: q, mode: "insensitive" as const } },
              },
            },
            {
              referee: { user: { email: { contains: q, mode: "insensitive" as const } } },
            },
          ],
        }
      : {}),
  };
  const [rows, count] = await Promise.all([
    prisma.referral.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 25,
      take: 25,
      include: {
        referrer: { include: { user: { select: { email: true } } } },
        referee: { include: { user: { select: { email: true } } } },
      },
    }),
    prisma.referral.count({ where }),
  ]);
  const query = new URLSearchParams({ status, q });
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/admin/loyalty">← Loyalty program</Link>
      <h1 className="text-3xl font-semibold">Referral activity</h1>
      <form className="grid gap-3 sm:grid-cols-3">
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
        <button className="self-end rounded-full bg-teal-700 p-3 text-white">
          Apply filters
        </button>
      </form>
      <p>{count} matching referrals · newest first</p>
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
