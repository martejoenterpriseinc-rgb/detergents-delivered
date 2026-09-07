import { describe, expect, it } from "vitest";
import {
  AuthzError,
  hasPermission,
  hasRole,
  permissionsForRoles,
  requirePermissionSync,
  requireRoleSync,
} from "./authz";
import { staffAccessDeniedReason } from "./credentials";

describe("authorization helpers", () => {
  it("grants SUPER_ADMIN every role check", () => {
    expect(hasRole(["SUPER_ADMIN"], ["ADMIN"])).toBe(true);
    expect(hasRole(["DRIVER"], ["ADMIN"])).toBe(false);
    expect(hasRole(["INVENTORY"], ["INVENTORY", "ADMIN"])).toBe(true);
  });

  it("requires an allowed role and throws AuthzError otherwise", () => {
    expect(() => requireRoleSync(["CUSTOMER"], ["ADMIN"])).toThrow(AuthzError);
    expect(() => requireRoleSync(["ADMIN"], ["ADMIN"])).not.toThrow();
  });

  it("derives permissions from roles including SUPER_ADMIN wildcard", () => {
    expect(permissionsForRoles(["CPA"])).toContain("finance.read");
    expect(permissionsForRoles(["SUPER_ADMIN"])).toContain("*");
  });

  it("blocks SUPER_ADMIN until bootstrap credentials are changed", () => {
    expect(
      staffAccessDeniedReason({
        authenticated: true,
        hasAllowedRole: true,
        mustChangeCredentials: true,
      }),
    ).toBe("credentials_change_required");
    expect(
      staffAccessDeniedReason({
        authenticated: true,
        hasAllowedRole: false,
        mustChangeCredentials: false,
      }),
    ).toBe("forbidden");
  });

  it("checks permission codes including wildcard", () => {
    expect(hasPermission(["orders.read"], "orders.read")).toBe(true);
    expect(hasPermission(["*"], "settings.write")).toBe(true);
    expect(hasPermission(["orders.read"], "orders.write")).toBe(false);
    expect(() => requirePermissionSync(["orders.read"], "orders.write")).toThrow(
      AuthzError,
    );
  });
});
