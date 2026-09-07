import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { registerWithCredentials } from "../actions";

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
        Save an email and password for later phases. You can shop the demo cart without an
        account.
      </p>
      {params.error ? (
        <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {params.error === "exists"
            ? "That email already has an account. Sign in instead."
            : "Check your name, email, and a password of at least 8 characters."}
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
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="w-full">
            Create account
          </Button>
        </form>
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
