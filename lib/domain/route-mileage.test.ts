import { expect, it } from "vitest";
import { hundredths, routeMileageInput } from "./route-mileage";
const input = {
  routeId: "route",
  requestKey: "12345678-1234-4123-8123-123456789012",
  version: 0,
  legs: [
    { sequence: 1, start: "1000.25", end: "1001.50", planned: "1.2" },
    { sequence: 2, start: "1001.50", end: "1002.75", planned: null },
  ],
};
it("keeps decimal mileage exact and accepts explicit zero travel", () => {
  expect(hundredths("1000.25")).toBe(100025);
  expect(hundredths("1.2")).toBe(120);
  expect(routeMileageInput.parse(input).legs).toHaveLength(2);
  expect(
    routeMileageInput.safeParse({
      ...input,
      legs: [{ sequence: 1, start: "10", end: "10", planned: null }],
    }).success,
  ).toBe(true);
});
it("rejects gaps, backward readings, partial pairs, duplicate legs and out-of-order actuals", () => {
  for (const legs of [
    [input.legs[0], { ...input.legs[1], start: "1002" }],
    [{ ...input.legs[0], end: "999" }],
    [{ ...input.legs[0], end: null }],
    [input.legs[0], input.legs[0]],
    [{ ...input.legs[0], start: null, end: null }, input.legs[1]],
    [{ ...input.legs[0], planned: "10001" }],
  ])
    expect(routeMileageInput.safeParse({ ...input, legs }).success).toBe(false);
});
it("requires a reason for changes and refuses excess precision", () => {
  expect(routeMileageInput.safeParse({ ...input, version: 1 }).success).toBe(false);
  expect(
    routeMileageInput.safeParse({
      ...input,
      legs: [{ ...input.legs[0], start: "1000.001" }],
    }).success,
  ).toBe(false);
});
