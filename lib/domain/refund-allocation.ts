import { z } from "zod";

const cents = z.number().int().min(0).max(100_000_000);
const quantities = z
  .object({
    purchased: z.number().int().min(1).max(100),
    alreadyRefunded: z.number().int().min(0).max(100),
    requested: z.number().int().min(1).max(100),
  })
  .strict()
  .refine(
    (v) => v.alreadyRefunded + v.requested <= v.purchased,
    "Refund quantity exceeds the remaining purchased quantity.",
  );
const allocationInput = z
  .object({
    quantities,
    netCents: cents,
    taxCents: cents,
    rewardCents: cents,
  })
  .strict();

const lineRequest = z
  .object({
    orderItemId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(100),
  })
  .strict();

export const refundRequestInput = z
  .object({
    requestKey: z.string().uuid(),
    orderId: z.string().min(1).max(100),
    paymentId: z.string().min(1).max(100),
    reason: z.string().trim().min(10).max(500),
    lines: z.array(lineRequest).min(1).max(30),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.lines.map((line) => line.orderItemId)).size === value.lines.length,
    "Each purchased item may appear once.",
  );

export const stockReturnInput = z
  .object({
    requestKey: z.string().uuid(),
    orderId: z.string().min(1).max(100),
    reason: z.string().trim().min(10).max(500),
    lines: z
      .array(lineRequest.extend({ condition: z.enum(["SELLABLE", "DAMAGED"]) }))
      .min(1)
      .max(30),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.lines.map((line) => line.orderItemId)).size === value.lines.length,
    "Each returned item may appear once.",
  );

export const cancelRefundInput = z
  .object({
    orderId: z.string().min(1).max(100),
    requestId: z.string().min(1).max(100),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

/** Slice a saved line cumulatively; successive partial returns conserve every cent. */
export function allocateRefundLine(input: z.input<typeof allocationInput>) {
  const { quantities: q, netCents, taxCents, rewardCents } = allocationInput.parse(input);
  const slice = (amount: number) =>
    Number(
      (BigInt(amount) * BigInt(q.alreadyRefunded + q.requested)) / BigInt(q.purchased) -
        (BigInt(amount) * BigInt(q.alreadyRefunded)) / BigInt(q.purchased),
    );
  const net = slice(netCents),
    tax = slice(taxCents);
  return {
    netCents: net,
    taxCents: tax,
    cashCents: net + tax,
    rewardCents: slice(rewardCents),
  };
}

/** Allocate the remaining saved cents after arbitrary draft cancellations/failures. */
export function allocateRemainingRefundLine(
  input: z.input<typeof allocationInput> & {
    allocated: { netCents: number; taxCents: number; rewardCents: number };
  },
) {
  const { allocated, ...raw } = input;
  const saved = allocationInput.parse(raw);
  const held = z
    .object({ netCents: cents, taxCents: cents, rewardCents: cents })
    .strict()
    .parse(allocated);
  for (const key of ["netCents", "taxCents", "rewardCents"] as const) {
    if (held[key] > saved[key] || (!saved.quantities.alreadyRefunded && held[key]))
      throw new Error("Saved refund allocations require reconciliation.");
  }
  // Quantity alone cannot locate the rounding remainder once an earlier request
  // is released. Subtract actual surviving allocations before dividing again.
  return allocateRefundLine({
    quantities: {
      purchased: saved.quantities.purchased - saved.quantities.alreadyRefunded,
      alreadyRefunded: 0,
      requested: saved.quantities.requested,
    },
    netCents: saved.netCents - held.netCents,
    taxCents: saved.taxCents - held.taxCents,
    rewardCents: saved.rewardCents - held.rewardCents,
  });
}

/** Unknown provider outcomes remain reserved until authoritative reconciliation. */
export const refundReservationStates = [
  "PREPARED",
  "SUBMITTING",
  "UNKNOWN",
  "PENDING",
  "REQUIRES_ACTION",
  "SUCCEEDED",
] as const;

export function assertRefundCapacity(input: {
  capturedCents: number;
  settledCents: number;
  unresolvedCents: number;
  requestedCents: number;
}) {
  const v = z
    .object({
      capturedCents: cents,
      settledCents: cents,
      unresolvedCents: cents,
      requestedCents: cents.positive(),
    })
    .strict()
    .parse(input);
  if (v.settledCents + v.unresolvedCents + v.requestedCents > v.capturedCents)
    throw new Error("Refund exceeds the unreserved captured amount.");
  return v.capturedCents - v.settledCents - v.unresolvedCents - v.requestedCents;
}
