import { describe, expect, it } from "vitest";
import {
  addCents,
  formatCents,
  marginBps,
  marginPercent,
  MoneyError,
  subtractCents,
} from "./money";

describe("money helpers", () => {
  it("adds and subtracts integer cents", () => {
    expect(addCents(199, 50, 1)).toBe(250);
    expect(subtractCents(500, 125)).toBe(375);
  });

  it("rejects floating-point amounts", () => {
    expect(() => addCents(1.5)).toThrow(MoneyError);
    expect(() => subtractCents(100, 0.01)).toThrow(MoneyError);
  });

  it("formats cents as currency without using float math for the value", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1099)).toBe("$10.99");
    expect(formatCents(-250)).toBe("-$2.50");
  });

  it("calculates margin in basis points from cents", () => {
    expect(marginBps(1000, 600)).toBe(4000);
    expect(marginPercent(1000, 600)).toBe(40);
    expect(() => marginBps(0, 100)).toThrow(MoneyError);
  });
});
