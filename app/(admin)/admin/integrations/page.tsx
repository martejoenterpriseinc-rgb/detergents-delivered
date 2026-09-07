import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Integrations"
      phase={7}
      summary="Stripe, Stripe Tax, QuickBooks, Maps, email, SMS, and object storage stay unconfigured."
    />
  );
}
