import { Card } from "@/components/ui/card";
import { PasswordRecoveryForm } from "@/components/storefront/password-recovery-form";
export const metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function ResetPasswordPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-3xl font-semibold text-teal-950">Choose a new password</h1>
      <Card className="mt-6">
        <PasswordRecoveryForm reset />
      </Card>
    </div>
  );
}
