import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DemoBanner({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950",
        className,
      )}
      role="status"
    >
      {children}
    </div>
  );
}
