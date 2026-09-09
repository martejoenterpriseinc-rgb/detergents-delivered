import Link from "next/link";
import { requireAuth } from "@/lib/authz";
import { customerIdentity } from "@/lib/services/customer-account";
import { prisma } from "@/lib/prisma";
import { AddressForm } from "@/components/commerce/address-form";
export default async function Page() {
  const session = await requireAuth();
  const { user, customer } = await customerIdentity(prisma, session.user.id);
  const addresses = await prisma.address.findMany({
    where: { customerId: customer.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <Link href="/account" className="underline">
        Back to account
      </Link>
      <h1 className="text-3xl font-semibold">Delivery addresses</h1>
      {!user.emailVerified && (
        <p>
          Email verification is still required before purchasing. Contact support if you
          need help.
        </p>
      )}
      {addresses
        .filter((a) => !a.validationSource?.startsWith("CHECKOUT_SNAPSHOT:"))
        .map((a) => (
          <div className="rounded-xl border p-4" key={a.id}>
            <strong>{a.line1}</strong>
            <p>
              {a.city}, {a.region} {a.postalCode}
            </p>
            <p>{a.validatedAt ? "Approved for delivery" : "Awaiting delivery review"}</p>
          </div>
        ))}
      <AddressForm />
    </div>
  );
}
