import { EmailVerification } from "@/components/storefront/email-verification";
export const metadata = {
  title: "Verify your email",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function VerifyEmailPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-3xl font-semibold text-teal-950">Email verification</h1>
      <EmailVerification confirm />
    </div>
  );
}
