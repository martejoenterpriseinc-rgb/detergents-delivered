import { requireAuth } from "@/lib/authz";
import { Card } from "@/components/ui/card";

export default async function AccountPage() {
  const session = await requireAuth();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-teal-950">Your account</h1>
      <p className="mt-2 text-teal-800">
        Orders, subscriptions, and delivery addresses will live here in later
        phases.
      </p>
      <Card className="mt-8 space-y-2">
        <p className="text-sm font-medium text-teal-900">{session.user.email}</p>
        <p className="text-sm text-teal-800">
          Roles: {session.user.roles.join(", ") || "none assigned yet"}
        </p>
      </Card>
    </div>
  );
}
