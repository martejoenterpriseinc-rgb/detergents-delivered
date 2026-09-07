import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Payments"
      phase={3}
      summary="Stripe is not connected. Payment and refund rows are append-safe by design."
    />
  );
}
