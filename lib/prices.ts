import type { PriceKind, ProductPrice } from "@prisma/client";

export function pickCurrentPrice(
  prices: (Pick<ProductPrice, "kind" | "amountCents" | "startsAt" | "endsAt"> & {
    currency?: string;
  })[],
  at = new Date(),
  kind: PriceKind = "RETAIL",
) {
  return (
    prices
      .filter(
        (price) =>
          price.kind === kind &&
          (price.currency === undefined || price.currency === "USD") &&
          price.startsAt <= at &&
          (price.endsAt === null || price.endsAt > at),
      )
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0] ?? null
  );
}
