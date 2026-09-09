import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { getLaunchWorkspace } from "@/lib/services/launch";
import { LaunchSettings } from "@/components/admin/launch-settings";
export default async function Page() {
  const session = await requireRole("ADMIN", "SUPER_ADMIN");
  const data = await getLaunchWorkspace(session.user.id);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-3xl font-semibold">
        Launch, delivery areas & vehicle capacity
      </h1>
      <Link className="font-semibold underline" href="/admin/deliveries/launch">
        Review launch demand →
      </Link>
      <LaunchSettings initial={data} />
    </div>
  );
}
