import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DeliverySettingsForm } from "@/components/admin/delivery-settings-form";
import { requireRole } from "@/lib/authz";
import { ADMIN_SHELL_ROLES, hasRole } from "@/lib/domain/authz";
import { getAppEnv } from "@/lib/env";
import { getDeliverySettings } from "@/lib/services/delivery-settings";

export default async function SettingsPage() {
  const session = await requireRole(...ADMIN_SHELL_ROLES);
  const env = getAppEnv();
  const settings = await getDeliverySettings();
  const canWrite = hasRole(session.user.roles, ["ADMIN", "SUPER_ADMIN"]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Settings</h1>
        <p className="mt-2 text-teal-800">
          Environment secrets stay in the host. Delivery coverage and weekly windows live
          in the settings table so staging defaults can be edited without a deploy.
        </p>
      </div>
      <Card>
        <p className="text-sm font-medium text-teal-900">Environment</p>
        <p className="mt-2 text-2xl font-semibold capitalize">{env}</p>
        <p className="mt-2 text-sm text-teal-800">
          Development must use a local or staging database, never production data.
        </p>
      </Card>
      {canWrite && (
        <Link className="ops-button" href="/admin/settings/launch">
          Launch, area cadence & vehicle capacity
        </Link>
      )}
      <DeliverySettingsForm initial={settings} canWrite={canWrite} />
    </div>
  );
}
