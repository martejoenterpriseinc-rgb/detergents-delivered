import { expect, it } from "vitest";
import { recordedCost } from "./quickbooks-cost";
const piece = {
  allocationId: "allocation",
  costLayerId: "layer",
  quantity: 2,
  unitCostCents: 401,
};
it("preserves original integer-cent FIFO amounts and accepts free stock", () => {
  expect(recordedCost([piece, { ...piece, quantity: 1, unitCostCents: 502 }])).toBe(1304);
  expect(recordedCost([{ ...piece, unitCostCents: 0 }])).toBe(0);
});
it("rejects incomplete, fractional, negative and oversized cost evidence", () => {
  for (const input of [
    [],
    [{}],
    [{ ...piece, quantity: 0.5 }],
    [{ ...piece, unitCostCents: -1 }],
    [{ ...piece, quantity: 100000000 }],
    Array(501).fill(piece),
  ])
    expect(() => recordedCost(input)).toThrow();
});
