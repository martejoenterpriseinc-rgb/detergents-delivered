import { requireAuth } from "@/lib/authz";
import { AccountDashboard } from "@/components/storefront/account-dashboard";
import { signOutAction } from "../actions";
import { Button } from "@/components/ui/button";

export default async function AccountPage() {
  const session = await requireAuth();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-teal-950">Your household</h1>
          <p className="mt-2 text-teal-800">
            Orders, delivery notes, and a preview of subscription controls.
          </p>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </div>
      <div className="mt-8">
        <AccountDashboard email={session.user.email ?? ""} roles={session.user.roles} />
      </div>
    </div>
  );
}
