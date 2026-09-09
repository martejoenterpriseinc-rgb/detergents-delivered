import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { googleSignInConfigured } from "@/lib/domain/customer-access";
import { registerWithCredentials, signInWithGoogle } from "../actions";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-16">
      <h1 className="text-3xl font-semibold text-teal-950">
        Create your household account
      </h1>
      <p className="mt-2 text-sm text-teal-800">
        Track your orders, save your delivery details, and manage your household account.
      </p>
      {params.error ? (
        <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {params.error === "limited"
            ? "Too many attempts. Try again in 15 minutes."
            : params.error === "unavailable"
              ? "An account could not be created with those details. Try signing in or recovering your password."
              : "Check your name, email, and matching passwords of at least 12 characters (up to 72 bytes)."}
        </p>
      ) : null}
      <Card className="mt-8 space-y-4">
        <form action={registerWithCredentials} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              required
            />
          </div>
          <Button type="submit" className="w-full">
            Create account
          </Button>
        </form>
        {googleSignInConfigured() && (
          <form action={signInWithGoogle}>
            <Button type="submit" variant="outline" className="w-full">
              Continue with Google
            </Button>
          </form>
        )}
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="font-semibold text-teal-800 underline">
            Recover your account
          </Link>
        </p>
        <p className="text-center text-sm text-teal-800">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-semibold text-teal-900 underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
