import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { requireAuth, userMustChangeCredentials } from "@/lib/authz";
import { hasRole, ADMIN_SHELL_ROLES } from "@/lib/domain/authz";
import { ChangeCredentialsForm } from "./change-credentials-form";

export const dynamic = "force-dynamic";

export default async function ChangeCredentialsPage() {
  const session = await requireAuth();
  const mustChange = await userMustChangeCredentials(session.user.id);
  if (!mustChange) {
    redirect(hasRole(session.user.roles, ADMIN_SHELL_ROLES) ? "/admin" : "/account");
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-16">
      <h1 className="text-3xl font-semibold text-teal-950">Change credentials</h1>
      <p className="mt-2 text-sm text-teal-800">
        This bootstrap account must set a new username/email and password before
        you can use admin.
      </p>
      <p className="mt-3 text-xs text-teal-700">
        Signed in as <span className="font-medium">{session.user.email}</span>
      </p>
      <Card className="mt-8">
        <ChangeCredentialsForm currentEmail={session.user.email ?? ""} />
      </Card>
    </div>
  );
}
