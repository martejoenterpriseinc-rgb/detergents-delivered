/**
 * Money helpers — integer minor units (cents) only.
 * Never use floating point for currency arithmetic.
 */

export type Cents = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertCents(value: number, label = "amount"): Cents {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of cents`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} is outside the safe integer range`);
  }
  return value;
}

export function addCents(...amounts: Cents[]): Cents {
  return amounts.reduce((sum, amount) => {
    assertCents(amount);
    const next = sum + amount;
    assertCents(next, "sum");
    return next;
  }, 0);
}

export function subtractCents(minuend: Cents, subtrahend: Cents): Cents {
  assertCents(minuend, "minuend");
  assertCents(subtrahend, "subtrahend");
  return assertCents(minuend - subtrahend, "difference");
}

export function multiplyCents(amount: Cents, quantity: number): Cents {
  assertCents(amount);
  if (!Number.isInteger(quantity)) {
    throw new MoneyError("quantity must be an integer");
  }
  return assertCents(amount * quantity, "product");
}

export function formatCents(
  amount: Cents,
  currency = "USD",
  locale = "en-US",
): string {
  assertCents(amount);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

/**
 * Gross margin in basis points (10000 = 100.00%).
 * sellingCents and costCents are both minor units.
 */
export function marginBps(sellingCents: Cents, costCents: Cents): number {
  assertCents(sellingCents, "sellingCents");
  assertCents(costCents, "costCents");
  if (sellingCents <= 0) {
    throw new MoneyError("sellingCents must be positive to calculate margin");
  }
  const margin = subtractCents(sellingCents, costCents);
  return Math.round((margin / sellingCents) * 10_000);
}

export function marginPercent(sellingCents: Cents, costCents: Cents): number {
  return marginBps(sellingCents, costCents) / 100;
}
