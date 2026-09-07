import { cn } from "@/lib/utils";

/** Official lockup is landscape (water-drop + map-pin + wordmark). */
const LOGO_WIDTH = 1400;
const LOGO_HEIGHT = 440;

export function BrandLogo({
  className,
  size = 40,
}: {
  className?: string;
  /** Rendered height in CSS pixels. Width follows the official lockup ratio. */
  size?: number;
}) {
  const width = Math.round((size * LOGO_WIDTH) / LOGO_HEIGHT);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/logo.png"
      alt="Detergents Delivered"
      width={width}
      height={size}
      className={cn(
        "h-8 w-auto max-w-[min(13.75rem,58vw)] shrink-0 object-contain object-left sm:h-10 sm:max-w-[16.25rem]",
        className,
      )}
    />
  );
}
