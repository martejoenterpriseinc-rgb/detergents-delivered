import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-teal-100 bg-white p-6 shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
