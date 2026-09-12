import Link from "next/link";
import { auth } from "@/auth";
import { Card } from "@/components/ui/card";
export default async function ContactPage() {
  const session = await auth();
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-12">
      <h1 className="text-3xl font-semibold">Contact us</h1>
      <Card className="space-y-4">
        <p>
          Need help with an order, delivery, or your account? Open a support ticket and
          follow replies in your account.
        </p>
        <Link
          href={
            session?.user
              ? "/account/support/new"
              : "/sign-in?callbackUrl=%2Faccount%2Fsupport%2Fnew"
          }
          className="inline-flex min-h-11 items-center rounded-full bg-teal-700 px-5 font-semibold text-white"
        >
          {session?.user ? "Contact support" : "Sign in to contact support"}
        </Link>
        {!session?.user && (
          <Link
            href="/register?callbackUrl=%2Faccount%2Fsupport%2Fnew"
            className="inline-flex min-h-11 items-center px-5 font-semibold text-teal-800 underline"
          >
            Create an account to contact support
          </Link>
        )}
      </Card>
    </div>
  );
}
