import { SmsConsentPanel } from "@/components/account/sms-consent";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/authz";
import { getCustomerAccount } from "@/lib/services/customer-account";
import { AccountSettingsForm } from "@/components/account/forms";
import { Card } from "@/components/ui/card";
const titles: Record<string, string> = {
  profile: "Edit customer info",
  security: "Change password",
  notifications: "Notifications",
};
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!titles[section]) notFound();
  const session = await requireAuth();
  const account = await getCustomerAccount(session.user.id);
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <Link href="/account" className="text-sm font-semibold text-teal-800">
        ← Your account
      </Link>
      <h1 className="text-3xl font-semibold">{titles[section]}</h1>
      <Card>
        <AccountSettingsForm account={account} section={section} />
      </Card>
      {section === "notifications" && <SmsConsentPanel />}
      {section === "security" ? (
        <Link href="/sign-in" className="inline-block font-semibold underline">
          Sign in
        </Link>
      ) : (
        <Link
          href="/account/support/new"
          className="inline-block font-semibold underline"
        >
          Contact us
        </Link>
      )}
    </div>
  );
}
