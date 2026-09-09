import Link from "next/link";
import { z } from "zod";
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
  const parsed = z
    .object({
      kind: z
        .enum(["ALL", "REFERRAL", "REDEMPTION", "REVERSAL", "RESTORE"])
        .default("ALL"),
      q: z.string().trim().max(100).default(""),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    })
    .safeParse(await searchParams);
  if (!parsed.success)
    return (
      <p>
        Invalid filters. <Link href="/admin/loyalty/rewards">Clear filters</Link>
      </p>
    );
  const { kind, q, page } = parsed.data;
  const where = {
    ...(kind === "ALL" ? {} : { kind }),
    ...(q
      ? { customer: { user: { email: { contains: q, mode: "insensitive" as const } } } }
      : {}),
  };
  const [rows, count] = await Promise.all([
    prisma.rewardEntry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 25,
      take: 25,
      include: { customer: { include: { user: { select: { email: true } } } } },
    }),
    prisma.rewardEntry.count({ where }),
  ]);
  const query = new URLSearchParams({ kind, q });
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/admin/loyalty">← Loyalty program</Link>
      <h1 className="text-3xl font-semibold">Rewards ledger</h1>
      <p>
        Original entries are never edited or deleted. Corrections appear as new entries.
      </p>
      <form className="grid gap-3 sm:grid-cols-3">
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
        <button className="self-end rounded-full bg-teal-700 p-3 text-white">
          Apply filters
        </button>
      </form>
      <p>{count} matching entries · newest first</p>
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
