import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Customers"
      phase={3}
      summary="Customer profiles and addresses are modeled but have no admin CRUD yet."
    />
  );
}
