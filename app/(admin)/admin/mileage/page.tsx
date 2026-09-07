import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Mileage"
      phase={5}
      summary="Vehicle trips and odometer records are in the schema for delivery ops."
    />
  );
}
