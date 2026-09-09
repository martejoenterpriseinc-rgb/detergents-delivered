import { describe, expect, it } from "vitest";
import { adminWorkspace, visibleAdminNav, workspaceActions } from "./admin-nav";
describe("consolidated admin workspaces", () => {
  it("keeps subordinate tools out of the drawer", () => {
    expect(visibleAdminNav(["SUPER_ADMIN"]).map((item) => item.label)).toEqual([
      "Dashboard",
      "Orders",
      "Deliveries",
      "Customers",
      "Inventory",
      "Receiving",
      "Website",
      "Payments",
      "Reports",
      "Settings",
    ]);
  });
  it("selects the correct parent for deep links and address approval exceptions", () => {
    for (const [path, parent] of [
      ["/admin/support/ticket", "customers"],
      ["/admin/loyalty/referrals", "customers"],
      ["/admin/products/item", "inventory"],
      ["/admin/categories", "inventory"],
      ["/admin/vendors/vendor", "receiving"],
      ["/admin/purchase-orders/new", "receiving"],
      ["/admin/cpa", "reports"],
      ["/admin/taxes", "reports"],
      ["/admin/customers/approvals", "settings"],
      ["/admin/settings/business/setup", "settings"],
      ["/admin/integrations", "settings"],
      ["/admin/website/builder", "website"],
    ])
      expect(adminWorkspace(path)).toBe(`/admin/${parent}`);
  });
  it("does not expose write actions to CPA or customer tools to inventory staff", () => {
    expect(
      workspaceActions("/admin/inventory", ["CPA"]).map((item) => item.label),
    ).toEqual(["Inventory", "Products"]);
    expect(workspaceActions("/admin/customers", ["INVENTORY"])).toEqual([]);
    expect(
      workspaceActions("/admin/inventory", ["SUPER_ADMIN"]).map((item) => item.label),
    ).toContain("+ Item");
  });
});
