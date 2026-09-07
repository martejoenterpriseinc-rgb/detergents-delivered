import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Inventory"
      phase={4}
      summary="Balances will be projections of inventory_transactions. No stock UI in Phase 1."
    />
  );
}
