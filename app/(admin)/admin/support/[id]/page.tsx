import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/authz";
import { getSupportTicket } from "@/lib/services/support";
import { SupportThread } from "@/components/account/support";
import { AccountError } from "@/lib/domain/account";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN");
  const ticket = await getSupportTicket(session.user.id, (await params).id, true).catch(
    (e) => {
      if (e instanceof AccountError && e.status === 404) notFound();
      throw e;
    },
  );
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/admin/support" className="font-semibold text-teal-800">
        ← Customer support
      </Link>
      <SupportThread ticket={ticket} staff={true} />
    </div>
  );
}
