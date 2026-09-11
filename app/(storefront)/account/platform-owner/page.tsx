import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth, hasRole } from "@/lib/authz";
import { ADMIN_SHELL_ROLES } from "@/lib/domain/authz";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { activateInitialOwnerAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PlatformOwnerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireAuth();
  if (hasRole(session.user.roles, ADMIN_SHELL_ROLES)) redirect("/admin");

  const configuredEmail = process.env.DD_INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  const email = session.user.email?.trim().toLowerCase() ?? "";
  if (!configuredEmail || email !== configuredEmail) redirect("/account");

  const marker = await prisma.setting.findUnique({ where: { key: "system.initialProductionOwner" } });
  if (marker) redirect("/account");
  const params = await searchParams;

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <Link href="/account" className="text-sm font-semibold text-teal-800 underline">
        Back to account
      </Link>
      <Card className="mt-6 space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">
            Platform setup
          </p>
          <h1 className="text-3xl font-semibold text-teal-950">Activate Owner / Admin</h1>
          <p className="text-sm text-teal-800">
            This one-time activation connects this existing customer account to platform owner
            access. Your customer account remains intact.
          </p>
          <p className="text-sm text-teal-700">Account: {session.user.email}</p>
        </div>
        {params.error === "invalid" && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            The activation code was rejected. No account or role changes were made.
          </p>
        )}
        <form action={activateInitialOwnerAction} className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-teal-950">Owner activation code</span>
            <input
              name="activationToken"
              type="password"
              autoComplete="one-time-code"
              required
              minLength={20}
              className="w-full rounded-xl border border-teal-200 px-3 py-2"
            />
          </label>
          <Button type="submit">Activate Owner / Admin access</Button>
        </form>
      </Card>
    </div>
  );
}
