import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-2xl border border-teal-200 bg-white px-4 text-sm text-teal-950 outline-none ring-teal-600 placeholder:text-teal-700/50 focus:ring-2",
        className,
      )}
      {...props}
    />
  );
}
