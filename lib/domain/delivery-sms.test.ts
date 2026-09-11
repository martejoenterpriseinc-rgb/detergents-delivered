import { expect, it } from "vitest";
import { smsPhone, smsDeliveryHour, smsConsentInput } from "./delivery-sms";
it("requires country-code phone numbers and explicit supported consent choices", () => {
  expect(smsPhone("+1 (555) 555-0100")).toBe("+15555550100");
  expect(smsPhone("5555550100")).toBeNull();
  expect(
    smsConsentInput.safeParse({ confirmed: false, timezone: "America/Chicago" }).success,
  ).toBe(false);
});
it("respects recipient time zones and daylight saving at delivery-window boundaries", () => {
  expect(smsDeliveryHour("America/Chicago", new Date("2026-07-01T12:59:00Z"))).toBe(
    false,
  );
  expect(smsDeliveryHour("America/Chicago", new Date("2026-07-01T13:00:00Z"))).toBe(true);
  expect(smsDeliveryHour("America/Chicago", new Date("2026-07-02T01:00:00Z"))).toBe(
    false,
  );
  expect(smsDeliveryHour("America/Chicago", new Date("2026-01-01T13:00:00Z"))).toBe(
    false,
  );
});
