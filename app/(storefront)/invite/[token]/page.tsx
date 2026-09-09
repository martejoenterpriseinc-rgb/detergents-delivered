import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) notFound();
  const invite = await prisma.customerInvite.findUnique({ where: { token } });
  if (!invite || invite.expiresAt < new Date()) notFound();
  return (
    <main className="mx-auto max-w-xl px-5 py-20">
      <h1 className="text-3xl font-semibold">You’re invited to Detergents Delivered</h1>
      <p className="my-5">
        Create your household account to get started. Your delivery address and
        eligibility must be approved before purchasing.
      </p>
      <Link href="/register" className="rounded-full bg-teal-700 px-6 py-3 text-white">
        Create an account
      </Link>
    </main>
  );
}
