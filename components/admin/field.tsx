import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

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
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-teal-700">{hint}</p> : null}
    </label>
  );
}
