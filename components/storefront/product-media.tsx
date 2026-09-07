import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

const FORM_TINT: Record<string, string> = {
  LIQUID: "from-sky-100 via-teal-50 to-cyan-100",
  POWDER: "from-amber-50 via-orange-50 to-teal-50",
  PODS: "from-violet-50 via-teal-50 to-emerald-50",
  SHEETS: "from-rose-50 via-teal-50 to-sky-50",
  OTHER: "from-lime-50 via-teal-50 to-cyan-50",
};

export function ProductMedia({
  name,
  brand,
  form,
  imageId,
  className,
}: {
  name: string;
  brand?: string | null;
  form?: string | null;
  imageId?: string | null;
  className?: string;
}) {
  if (imageId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/catalog/media/${imageId}`}
        alt={name}
        className={cn("h-48 w-full rounded-2xl bg-teal-50 object-cover", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative flex h-48 w-full flex-col items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br",
        FORM_TINT[form ?? "OTHER"] ?? FORM_TINT.OTHER,
        className,
      )}
    >
      <div className="absolute -top-8 -right-6 h-24 w-24 rounded-full bg-white/40" />
      <div className="absolute -bottom-10 -left-4 h-28 w-28 rounded-full bg-teal-200/30" />
      <Package className="relative h-10 w-10 text-teal-800" aria-hidden />
      <p className="relative mt-3 px-4 text-center text-sm font-semibold text-teal-950">
        {name}
      </p>
      {brand ? (
        <p className="relative mt-1 text-xs tracking-wide text-teal-700 uppercase">
          {brand}
        </p>
      ) : null}
    </div>
  );
}
