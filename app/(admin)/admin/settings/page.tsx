import { Card } from "@/components/ui/card";
import { getAppEnv } from "@/lib/env";

export default function SettingsPage() {
  const env = getAppEnv();

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold text-teal-950">Settings</h1>
      <Card>
        <p className="text-sm font-medium text-teal-900">Environment</p>
        <p className="mt-2 text-2xl font-semibold capitalize">{env}</p>
        <p className="mt-2 text-sm text-teal-800">
          Development must use a local or staging database, never production
          data. Integration secrets belong in the host environment, not in code.
        </p>
      </Card>
    </div>
  );
}
