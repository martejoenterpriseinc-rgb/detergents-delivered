import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PasswordRecoveryForm } from "@/components/storefront/password-recovery-form";

export const metadata = {
  title: "Recover your account",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-3xl font-semibold text-teal-950">Forgot your password?</h1>
      <p className="mt-3 text-sm text-teal-800">
        Enter your account email to request a link to choose a new password.
      </p>
      <Card className="mt-6">
        <PasswordRecoveryForm />
      </Card>
      <div className="mt-6 space-y-3 text-sm text-teal-800">
        <p>
          Use Google to sign in?{" "}
          <a
            href="https://accounts.google.com/signin/recovery"
            className="font-semibold underline"
            rel="noreferrer"
          >
            Recover your Google account
          </a>
          .
        </p>
        <p>
          Forgot your account email? Check your inboxes for Detergents Delivered order
          receipts. For Google accounts,{" "}
          <a
            href="https://accounts.google.com/signin/usernamerecovery"
            className="font-semibold underline"
            rel="noreferrer"
          >
            find your Google email
          </a>
          .
        </p>
        <Link href="/sign-in" className="inline-block font-semibold underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
