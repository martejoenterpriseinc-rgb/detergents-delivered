import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Reports"
      phase={8}
      summary="Operational and financial reports wait until transactions exist."
    />
  );
}
