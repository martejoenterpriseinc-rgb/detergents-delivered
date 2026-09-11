import { requireAuth } from "@/lib/authz";
import { getCustomerAccount } from "@/lib/services/customer-account";
import { listCommerceGrants } from "@/lib/services/commerce-grants";
import { Connections } from "@/components/account/connections";
export default async function Page() {
  const session = await requireAuth(),
    account = await getCustomerAccount(session.user.id);
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-10">
      <a href="/account" className="underline">
        Back to account
      </a>
      <h1 className="text-3xl font-semibold">Connected apps</h1>
      {account.hasCustomer ? (
        <Connections
          grants={await listCommerceGrants(session.user.id)}
          canCreate={account.emailVerified}
        />
      ) : (
        <p>Connections are available through a household account.</p>
      )}
    </main>
  );
}
