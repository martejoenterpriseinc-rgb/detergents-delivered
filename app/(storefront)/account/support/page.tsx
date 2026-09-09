import Link from "next/link";
import { requireAuth } from "@/lib/authz";
import { SupportList } from "@/components/account/support";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAuth();
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link href="/account" className="font-semibold text-teal-800">
        ← Your account
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">Support tickets</h1>
        <Link
          href="/account/support/new"
          className="inline-flex min-h-11 items-center rounded-full bg-teal-700 px-5 font-semibold text-white"
        >
          Contact us
        </Link>
      </div>
      <SupportList userId={session.user.id} staff={false} search={await searchParams} />
    </div>
  );
}
