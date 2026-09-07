import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_ADMIN_EMAIL,
  DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
  isChangeCredentialsPath,
  mustRedirectToChangeCredentials,
  staffAccessDeniedReason,
  validateCredentialChange,
} from "./credentials";

describe("credential change validation", () => {
  const valid = {
    currentEmail: BOOTSTRAP_ADMIN_EMAIL,
    newEmail: "owner@detergentsdelivered.com",
    newPassword: "A-sufficiently-long-pass",
    confirmPassword: "A-sufficiently-long-pass",
  };

  it("accepts a new email and strong password", () => {
    expect(validateCredentialChange(valid)).toEqual({
      ok: true,
      email: "owner@detergentsdelivered.com",
      password: "A-sufficiently-long-pass",
    });
  });

  it("requires a new email different from the bootstrap login", () => {
    const result = validateCredentialChange({
      ...valid,
      newEmail: BOOTSTRAP_ADMIN_EMAIL,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects the documented temporary password", () => {
    const result = validateCredentialChange({
      ...valid,
      newPassword: DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
      confirmPassword: DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/temporary/i);
    }
  });

  it("rejects a custom temporary password from env", () => {
    const result = validateCredentialChange({
      ...valid,
      newPassword: "Another-Temp-Pass!",
      confirmPassword: "Another-Temp-Pass!",
      temporaryPasswords: ["Another-Temp-Pass!"],
    });
    expect(result.ok).toBe(false);
  });

  it("requires at least 12 characters and a matching confirmation", () => {
    expect(
      validateCredentialChange({
        ...valid,
        newPassword: "short",
        confirmPassword: "short",
      }).ok,
    ).toBe(false);
    expect(
      validateCredentialChange({
        ...valid,
        confirmPassword: "A-sufficiently-long-pass-X",
      }).ok,
    ).toBe(false);
  });
});

describe("force-change gate", () => {
  it("blocks /admin and /driver until credentials are changed", () => {
    expect(mustRedirectToChangeCredentials("/admin", true)).toBe(true);
    expect(mustRedirectToChangeCredentials("/admin/products", true)).toBe(true);
    expect(mustRedirectToChangeCredentials("/driver", true)).toBe(true);
    expect(mustRedirectToChangeCredentials("/account", true)).toBe(true);
  });

  it("allows the change-credentials page itself", () => {
    expect(isChangeCredentialsPath("/account/change-credentials")).toBe(true);
    expect(mustRedirectToChangeCredentials("/account/change-credentials", true)).toBe(
      false,
    );
  });

  it("does not gate users who already rotated credentials", () => {
    expect(mustRedirectToChangeCredentials("/admin", false)).toBe(false);
    expect(mustRedirectToChangeCredentials("/shop", true)).toBe(false);
  });

  it("denies staff API access before role checks when a change is required", () => {
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
        hasAllowedRole: true,
        mustChangeCredentials: false,
      }),
    ).toBeNull();
    expect(
      staffAccessDeniedReason({
        authenticated: false,
        hasAllowedRole: false,
        mustChangeCredentials: false,
      }),
    ).toBe("unauthenticated");
  });
});
