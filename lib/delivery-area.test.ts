import { describe, expect, it } from "vitest";
import { checkDeliveryZip, DEMO_DELIVERY_ZIPS, zoneNameForZip } from "./delivery-area";

describe("demo delivery area", () => {
  it("accepts configured demo ZIPs", () => {
    const result = checkDeliveryZip("50309");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.zoneName).toBe("Des Moines core");
    }
    expect(zoneNameForZip("50265")).toBe("West metro");
    expect(DEMO_DELIVERY_ZIPS).toContain("50023");
  });

  it("rejects incomplete or out-of-area ZIPs", () => {
    expect(checkDeliveryZip("503").ok).toBe(false);
    expect(checkDeliveryZip("99999").ok).toBe(false);
  });

  it("normalizes ZIP+4 input", () => {
    const result = checkDeliveryZip("50309-1234");
    expect(result.ok).toBe(true);
    expect(result.zip).toBe("50309");
  });
});
