import Link from "next/link";
import { auth } from "@/auth";
import { publicReferral } from "@/lib/services/loyalty";
import { ClaimReferral } from "@/components/loyalty/customer";
import { formatCents } from "@/lib/domain/money";
import { Card } from "@/components/ui/card";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const offer = await publicReferral(token);
  const session = await auth();
  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-12">
      <h1 className="text-3xl font-semibold">Your neighbor invited you</h1>
      <Card className="space-y-4">
        {!offer ? (
          <p>
            This referral is paused, expired or already claimed. Ask your neighbor for a
            new link.
          </p>
        ) : (
          <>
            <p>
              Earn {formatCents(offer.friendRewardCents)} in credits for a future order
              after your first qualifying paid purchase of at least{" "}
              {formatCents(offer.minimumPurchaseCents)} in merchandise.
            </p>
            <p className="text-sm">
              A verified new customer account and delivery eligibility are required. No
              reward is issued just for opening a link.
            </p>
            {session?.user ? (
              <ClaimReferral token={token} />
            ) : (
              <>
                <Link
                  className="block font-semibold underline"
                  href={`/sign-in?callbackUrl=${encodeURIComponent(`/r/${token}`)}`}
                >
                  Sign in to claim
                </Link>
                <Link className="block font-semibold underline" href="/register">
                  Create an account
                </Link>
                <p className="text-sm">
                  After registration and email verification, return to this invitation to
                  claim it.
                </p>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
