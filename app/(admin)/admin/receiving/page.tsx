import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Receiving"
      phase={4}
      summary="Receipts will post ledger transactions. Do not edit balances directly."
    />
  );
}
