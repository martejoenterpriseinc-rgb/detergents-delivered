import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { supportKpis } from "@/lib/services/support";
import { SUPPORT_STATUSES, SUPPORT_LABELS } from "@/lib/domain/account";
import { SupportList } from "@/components/account/support";
import { Card } from "@/components/ui/card";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN");
  const counts = await supportKpis(session.user.id);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Customer support</h1>
      <p className="text-teal-800">
        Order problems and account questions. Replies appear in the customer’s account.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SUPPORT_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/support?status=${s}`}
            className="rounded-3xl focus-visible:outline-2 focus-visible:outline-teal-700"
          >
            <Card className="hover:bg-teal-50">
              <p className="text-sm">{SUPPORT_LABELS[s]}</p>
              <p className="mt-2 text-3xl font-semibold">{counts[s]}</p>
              <p className="mt-2 text-xs text-teal-700">View matching tickets →</p>
            </Card>
          </Link>
        ))}
      </div>
      <SupportList userId={session.user.id} staff={true} search={await searchParams} />
    </div>
  );
}
