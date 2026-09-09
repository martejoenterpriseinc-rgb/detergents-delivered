import type { ReactNode } from "react";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-teal-950">{label}</span>
      {children}
      {hint ? <p className="text-xs text-teal-700">{hint}</p> : null}
    </label>
  );
}
