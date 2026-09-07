import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Purchase Orders"
      phase={4}
      summary="Vendor POs and landed-cost fields are in the schema. Workflow comes later."
    />
  );
}
