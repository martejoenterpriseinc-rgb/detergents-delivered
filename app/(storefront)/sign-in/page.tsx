import { runtimeGoogleConfigured } from "@/lib/integrations/google";
import { safeLoginCallback } from "@/lib/domain/login-destination";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { signInWithCredentials, signInWithGoogle } from "../actions";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeLoginCallback(params.callbackUrl);
  const googleEnabled = await runtimeGoogleConfigured();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-16">
      <h1 className="text-3xl font-semibold text-teal-950">Welcome back</h1>
      <p className="mt-2 text-sm text-teal-800">
        Your orders, delivery updates, and household essentials, all in one place.
      </p>
      {params.error ? (
        <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {params.error === "forbidden"
            ? "You do not have access to that area."
            : params.error === "OAuthAccountNotLinked"
              ? "Use the sign-in method you originally used for this account. You can reset your password below."
              : "Sign-in failed. Check your details and try again shortly."}
        </p>
      ) : null}
      <Card className="mt-8 space-y-4">
        <form action={signInWithCredentials} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              required
              maxLength={200}
            />
          </div>
          <Link
            href="/forgot-password"
            className="inline-block text-sm font-semibold text-teal-800 underline"
          >
            Forgot password or login details?
          </Link>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
        {googleEnabled ? (
          <form action={signInWithGoogle}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <Button type="submit" variant="outline" className="w-full">
              Continue with Google
            </Button>
          </form>
        ) : null}
        <p className="text-center text-sm text-teal-800">
          New household?{" "}
          <Link href="/register" className="font-semibold text-teal-900 underline">
            Create an account
          </Link>
        </p>
      </Card>
    </div>
  );
}
