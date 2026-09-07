import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Taxes"
      phase={7}
      summary="TaxService is an interface only. Stripe Tax will snapshot destination tax."
    />
  );
}
