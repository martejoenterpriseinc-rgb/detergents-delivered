import { describe, expect, it } from "vitest";
import {
  checkDeliveryZip,
  DEMO_DELIVERY_ZIPS,
  EXAMPLE_DELIVERY_ZIP,
  zoneNameForZip,
} from "./delivery-area";

describe("demo delivery area", () => {
  it("accepts select ZIPs in the default-enabled counties", () => {
    const result = checkDeliveryZip(EXAMPLE_DELIVERY_ZIP);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.zoneName).toBe("McHenry County select");
      expect(result.message.toLowerCase()).toContain("weekly delivery");
      expect(result.message.toLowerCase()).toContain("do not offer same-day");
    }
    expect(zoneNameForZip("60174")).toBe("Kane County select");
    expect(zoneNameForZip("60067")).toBe("Cook County select");
    expect(DEMO_DELIVERY_ZIPS).toContain("60142");
    expect(DEMO_DELIVERY_ZIPS).toContain("60193");
  });

  it("rejects incomplete, downtown Chicago, and disabled-county ZIPs", () => {
    expect(checkDeliveryZip("600").ok).toBe(false);
    expect(checkDeliveryZip("99999").ok).toBe(false);
    expect(checkDeliveryZip("50309").ok).toBe(false);
    expect(checkDeliveryZip("60601").ok).toBe(false);
    expect(checkDeliveryZip("60540").ok).toBe(false);
    expect(checkDeliveryZip("60085").ok).toBe(false);
  });

  it("accepts another county only when that county is enabled", () => {
    const disabled = checkDeliveryZip("60540", {
      enabledCountyCodes: ["mchenry", "kane", "cook"],
    });
    expect(disabled.ok).toBe(false);
    const enabled = checkDeliveryZip("60540", {
      enabledCountyCodes: ["mchenry", "kane", "cook", "dupage"],
      nextWindowLabel: "Tuesday, Sep 8, 9:00 AM–3:00 PM",
    });
    expect(enabled.ok).toBe(true);
    if (enabled.ok) {
      expect(enabled.zoneName).toBe("DuPage County select");
      expect(enabled.message).toContain("Tuesday, Sep 8");
    }
  });

  it("normalizes ZIP+4 input", () => {
    const result = checkDeliveryZip(`${EXAMPLE_DELIVERY_ZIP}-1234`);
    expect(result.ok).toBe(true);
    expect(result.zip).toBe(EXAMPLE_DELIVERY_ZIP);
  });
});
