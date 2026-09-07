/**
 * Landed cost allocation — integer cents only.
 * Header acquisition costs are spread across lines; remainders go to the last positive-qty line.
 */

import {
  addCents,
  assertCents,
  type Cents,
  MoneyError,
  multiplyCents,
  subtractCents,
} from "./money";

export type LandedCostLineInput = {
  id: string;
  quantity: number;
  unitCostCents: Cents;
  discountCents?: Cents;
  freightCents?: Cents;
  feeCents?: Cents;
  taxCents?: Cents;
  otherCostCents?: Cents;
};

export type LandedCostHeaderInput = {
  freightCents?: Cents;
  feeCents?: Cents;
  taxCents?: Cents;
  otherCostCents?: Cents;
};

export type AllocatedLandedCostLine = {
  id: string;
  quantity: number;
  merchandiseCents: Cents;
  allocatedHeaderCents: Cents;
  lineExtraCents: Cents;
  landedTotalCents: Cents;
  landedUnitCostCents: Cents;
};

export type LandedCostAllocation = {
  lines: AllocatedLandedCostLine[];
  merchandiseCents: Cents;
  headerCostCents: Cents;
  landedTotalCents: Cents;
};

function assertNonNegativeQty(quantity: number): number {
  if (!Number.isInteger(quantity)) {
    throw new MoneyError("quantity must be an integer");
  }
  if (quantity < 0) {
    throw new MoneyError("quantity cannot be negative");
  }
  return quantity;
}

function optionalCents(value: Cents | undefined, label: string): Cents {
  if (value === undefined) return 0;
  const cents = assertCents(value, label);
  if (cents < 0) {
    throw new MoneyError(`${label} cannot be negative`);
  }
  return cents;
}

export function lineMerchandiseCents(line: LandedCostLineInput): Cents {
  const qty = assertNonNegativeQty(line.quantity);
  const unit = assertCents(line.unitCostCents, "unitCostCents");
  if (unit < 0) {
    throw new MoneyError("unitCostCents cannot be negative");
  }
  const discount = optionalCents(line.discountCents, "discountCents");
  const merchandise = subtractCents(multiplyCents(unit, qty), discount);
  if (merchandise < 0) {
    throw new MoneyError("discount cannot exceed merchandise");
  }
  return merchandise;
}

export function headerAcquisitionCents(header: LandedCostHeaderInput = {}): Cents {
  return addCents(
    optionalCents(header.freightCents, "freightCents"),
    optionalCents(header.feeCents, "feeCents"),
    optionalCents(header.taxCents, "taxCents"),
    optionalCents(header.otherCostCents, "otherCostCents"),
  );
}

/**
 * Allocate header freight/fees/taxes/other across lines by merchandise weight.
 * Line-level extras stay on that line. Unit cost is floor-divided; leftover cents
 * are added to the last line with quantity > 0 so totals stay exact.
 */
export function allocateLandedCost(
  lines: LandedCostLineInput[],
  header: LandedCostHeaderInput = {},
): LandedCostAllocation {
  if (lines.length === 0) {
    const headerCostCents = headerAcquisitionCents(header);
    return {
      lines: [],
      merchandiseCents: 0,
      headerCostCents,
      landedTotalCents: headerCostCents,
    };
  }

  const headerCostCents = headerAcquisitionCents(header);
  const merchPerLine = lines.map((line) => lineMerchandiseCents(line));
  const merchandiseCents = addCents(...merchPerLine);
  const basis = merchandiseCents > 0 ? merchandiseCents : lines.reduce((sum, line) => sum + line.quantity, 0);

  let allocatedSoFar = 0;
  const positiveQtyIndexes = lines
    .map((line, index) => ({ index, quantity: line.quantity }))
    .filter((row) => row.quantity > 0)
    .map((row) => row.index);
  const lastPositive = positiveQtyIndexes.at(-1);

  const allocatedLines: AllocatedLandedCostLine[] = lines.map((line, index) => {
    const merchandise = merchPerLine[index] ?? 0;
    const lineExtraCents = addCents(
      optionalCents(line.freightCents, "line freightCents"),
      optionalCents(line.feeCents, "line feeCents"),
      optionalCents(line.taxCents, "line taxCents"),
      optionalCents(line.otherCostCents, "line otherCostCents"),
    );

    let allocatedHeaderCents = 0;
    if (headerCostCents > 0 && lastPositive !== undefined) {
      if (index === lastPositive) {
        allocatedHeaderCents = subtractCents(headerCostCents, allocatedSoFar);
      } else if (basis > 0) {
        const share = merchandiseCents > 0 ? merchandise : line.quantity;
        allocatedHeaderCents = Math.floor((headerCostCents * share) / basis);
        allocatedSoFar += allocatedHeaderCents;
      }
    }

    const landedTotalCents = addCents(merchandise, lineExtraCents, allocatedHeaderCents);
    let landedUnitCostCents = 0;
    if (line.quantity > 0) {
      landedUnitCostCents = Math.floor(landedTotalCents / line.quantity);
    }

    return {
      id: line.id,
      quantity: line.quantity,
      merchandiseCents: merchandise,
      allocatedHeaderCents,
      lineExtraCents,
      landedTotalCents,
      landedUnitCostCents,
    };
  });

  return {
    lines: allocatedLines,
    merchandiseCents,
    headerCostCents,
    landedTotalCents: addCents(
      merchandiseCents,
      headerCostCents,
      ...allocatedLines.map((line) => line.lineExtraCents),
    ),
  };
}
