import { Card } from "@/components/ui/card";

export function PhasePlaceholder({
  title,
  phase,
  summary,
}: {
  title: string;
  phase: number;
  summary: string;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold text-teal-950">{title}</h1>
      <Card>
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
          Coming in Phase {phase}
        </p>
        <p className="mt-2 text-sm text-teal-800">{summary}</p>
      </Card>
    </div>
  );
}
