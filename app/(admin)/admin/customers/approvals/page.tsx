import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { ApproveAddress } from "@/components/commerce/admin-actions";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  await requireRole("ADMIN", "SUPER_ADMIN");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 160) : "";
  const requestedPage =
    typeof params.page === "string" && /^\d{1,7}$/.test(params.page)
      ? Number(params.page)
      : 1;
  const where: Prisma.AddressWhereInput = {
    validatedAt: null,
    deletedAt: null,
    customer: { deletedAt: null, user: { deletedAt: null } },
    ...(q
      ? {
          OR: [
            { line1: { contains: q, mode: "insensitive" } },
            { postalCode: { contains: q, mode: "insensitive" } },
            { customer: { firstName: { contains: q, mode: "insensitive" } } },
            { customer: { lastName: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const count = await prisma.address.count({ where });
  const pages = Math.max(1, Math.ceil(count / 50));
  const page = Math.min(pages, Math.max(1, requestedPage));
  const rows = await prisma.address.findMany({
    where,
    include: { customer: { include: { user: { select: { emailVerified: true } } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: (page - 1) * 50,
    take: 50,
  });
  const href = (target: number) =>
    `/admin/customers/approvals?${new URLSearchParams({ q, page: String(target) })}`;
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold">Delivery address approvals</h1>
      <p>
        Approve after checking the location and access. Email verification is a separate
        requirement.
      </p>
      <form
        method="get"
        action="/admin/customers/approvals"
        className="flex flex-wrap items-end gap-3"
      >
        <label className="min-w-0 flex-1">
          Find an address
          <input
            name="q"
            defaultValue={q}
            maxLength={160}
            placeholder="Street, ZIP or customer name"
            className="mt-1 block w-full rounded-xl border p-3"
          />
        </label>
        <button className="ops-button">Search addresses</button>
        {q && (
          <Link className="underline" href="/admin/customers/approvals">
            Clear search
          </Link>
        )}
      </form>
      <nav
        aria-label="Address review pages"
        className="flex flex-wrap items-center gap-4 text-sm"
      >
        <p>
          {count} awaiting review · Page {page} of {pages}
        </p>
        {page > 1 && (
          <Link className="underline" href={href(page - 1)}>
            Previous page
          </Link>
        )}
        {page < pages && (
          <Link className="underline" href={href(page + 1)}>
            Next page
          </Link>
        )}
      </nav>
      {!rows.length && (
        <p>
          {q
            ? "No pending addresses match your search."
            : "No addresses awaiting review."}
        </p>
      )}
      {rows.map((a) => (
        <section className="space-y-3 rounded-2xl border bg-white p-5" key={a.id}>
          <h2 className="font-semibold">
            {a.customer.firstName} {a.customer.lastName}
          </h2>
          <p>
            {a.line1} {a.line2}, {a.city}, {a.region} {a.postalCode}
          </p>
          <p>Email {a.customer.user.emailVerified ? "verified" : "not verified"}</p>
          <ApproveAddress id={a.id} version={a.updatedAt.toISOString()} />
        </section>
      ))}
    </div>
  );
}
