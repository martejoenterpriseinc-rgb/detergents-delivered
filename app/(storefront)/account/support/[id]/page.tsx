import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/authz";
import { getSupportTicket } from "@/lib/services/support";
import { SupportThread } from "@/components/account/support";
import { AccountError } from "@/lib/domain/account";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  const ticket = await getSupportTicket(session.user.id, id).catch((e) => {
    if (e instanceof AccountError && e.status === 404) notFound();
    throw e;
  });
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link href="/account/support" className="font-semibold text-teal-800">
        ← Support tickets
      </Link>
      <SupportThread ticket={ticket} staff={false} />
    </div>
  );
}
