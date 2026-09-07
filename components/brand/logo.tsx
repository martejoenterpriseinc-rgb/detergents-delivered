import { cn } from "@/lib/utils";

/** Official wordmark aspect ~2.38:1 (trimmed PNG). `size` is display height in px. */
const LOGO_ASPECT = 457 / 192;

export function BrandLogo({
  className,
  size = 40,
}: {
  className?: string;
  size?: number;
}) {
  const width = Math.round(size * LOGO_ASPECT);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/logo.png"
      alt="Detergents Delivered"
      width={width}
      height={size}
      className={cn("shrink-0", className)}
      style={{ height: size, width: "auto" }}
    />
  );
}
