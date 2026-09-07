import { cn } from "@/lib/utils";

export function BrandLogo({
  className,
  size = 40,
}: {
  className?: string;
  size?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/logo.svg"
      alt="Detergents Delivered"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    />
  );
}
