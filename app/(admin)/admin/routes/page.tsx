import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Routes"
      phase={5}
      summary="Zone scheduling and stop sequencing will live here. The Route tables exist in Prisma."
    />
  );
}
