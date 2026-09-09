import { BusinessSetupCard } from "@/components/business/dashboard-card";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DeliverySettingsForm } from "@/components/admin/delivery-settings-form";
import { requireRole } from "@/lib/authz";
import { ADMIN_SHELL_ROLES, hasRole } from "@/lib/domain/authz";
import { EnvironmentSettings } from "@/components/admin/environment-settings";
import { getDeliverySettings } from "@/lib/services/delivery-settings";

export default async function SettingsPage() {
  const session = await requireRole(...ADMIN_SHELL_ROLES);
  const settings = await getDeliverySettings();
  const canWrite = hasRole(session.user.roles, ["ADMIN", "SUPER_ADMIN"]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-teal-950">Settings</h1>
        <p className="mt-2 text-teal-800">
          Update API credentials, switch environments and manage your business.
        </p>
      </div>
      {canWrite && <EnvironmentSettings />}
      {canWrite && (
        <Link className="ops-button" href="/admin/settings/launch">
          Launch, area cadence & vehicle capacity
        </Link>
      )}
      {canWrite && (
        <Card>
          <h2 className="text-xl font-semibold">Business Settings</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link className="ops-button" href="/admin/settings/business/setup">
              Business Setup
            </Link>
            <Link
              className="ops-button secondary"
              href="/admin/settings/business/documents"
            >
              Business Documents
            </Link>
          </div>
        </Card>
      )}
      <BusinessSetupCard userId={session.user.id} showCompleted />
      <details className="rounded-xl border border-teal-100 bg-white p-5">
        <summary className="cursor-pointer text-lg font-semibold">
          Delivery settings · counties & weekly route days
        </summary>
        <div className="mt-5">
          <DeliverySettingsForm initial={settings} canWrite={canWrite} />
        </div>
      </details>
    </div>
  );
}
