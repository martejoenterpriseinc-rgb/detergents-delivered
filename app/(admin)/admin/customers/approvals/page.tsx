import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { ApproveAddress } from "@/components/commerce/admin-actions";
export default async function Page() {
  await requireRole("ADMIN", "SUPER_ADMIN");
  const rows = await prisma.address.findMany({
    where: { validatedAt: null, deletedAt: null, customer: { deletedAt: null } },
    include: { customer: { include: { user: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold">Delivery address approvals</h1>
      <p>
        Approve after checking the location and access. Email verification is a separate
        requirement.
      </p>
      {!rows.length && <p>No addresses awaiting review.</p>}
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
