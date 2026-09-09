export const CHANGE_CREDENTIALS_PATH = "/account/change-credentials";
export const BOOTSTRAP_ADMIN_EMAIL = "admin@detergentsdelivered.com";
export const MIN_PASSWORD_LENGTH = 12;

/** Documented temporary staging default. Override with SEED_BOOTSTRAP_ADMIN_PASSWORD. */
export const DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD = "ChangeMe-Now-DD-2026!";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export function normalizeLoginEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidLoginEmail(value: string): boolean {
  const email = normalizeLoginEmail(value);
  return email.length >= 3 && email.length <= 320 && EMAIL_PATTERN.test(email);
}

export function isChangeCredentialsPath(pathname: string): boolean {
  return (
    pathname === CHANGE_CREDENTIALS_PATH ||
    pathname.startsWith(`${CHANGE_CREDENTIALS_PATH}/`)
  );
}

export function isCredentialGatedPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/driver" ||
    pathname.startsWith("/driver/") ||
    pathname === "/account" ||
    pathname.startsWith("/account/")
  );
}

/**
 * True when a signed-in user still on temporary bootstrap credentials
 * must be sent to the change-credentials form instead of a gated route.
 */
export function mustRedirectToChangeCredentials(
  pathname: string,
  mustChangeCredentials: boolean,
): boolean {
  return (
    mustChangeCredentials &&
    isCredentialGatedPath(pathname) &&
    !isChangeCredentialsPath(pathname)
  );
}

export type CredentialChangeInput = {
  currentEmail: string;
  newEmail: string;
  newPassword: string;
  confirmPassword: string;
  temporaryPasswords?: readonly string[];
};

export type CredentialChangeValidation =
  { ok: true; email: string; password: string } | { ok: false; error: string };

export function validateCredentialChange(
  input: CredentialChangeInput,
): CredentialChangeValidation {
  const currentEmail = normalizeLoginEmail(input.currentEmail);
  const email = normalizeLoginEmail(input.newEmail);

  if (!isValidLoginEmail(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (email === currentEmail) {
    return {
      ok: false,
      error: "Choose a new username/email that is different from the bootstrap login.",
    };
  }
  if (email === BOOTSTRAP_ADMIN_EMAIL) {
    return {
      ok: false,
      error: "The bootstrap login email cannot be reused.",
    };
  }

  const password = input.newPassword;
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (new TextEncoder().encode(password).length > 72) {
    return { ok: false, error: "Password must be at most 72 bytes." };
  }
  if (password !== input.confirmPassword) {
    return { ok: false, error: "Password confirmation does not match." };
  }

  const banned = new Set(
    (input.temporaryPasswords ?? []).filter((value) => value.length > 0),
  );
  banned.add(DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD);
  if (banned.has(password)) {
    return {
      ok: false,
      error: "New password cannot be the temporary bootstrap password.",
    };
  }

  return { ok: true, email, password };
}

export type StaffAccessDenial =
  "unauthenticated" | "forbidden" | "credentials_change_required";

export function staffAccessDeniedReason(input: {
  authenticated: boolean;
  hasAllowedRole: boolean;
  mustChangeCredentials: boolean;
}): StaffAccessDenial | null {
  if (!input.authenticated) return "unauthenticated";
  if (input.mustChangeCredentials) return "credentials_change_required";
  if (!input.hasAllowedRole) return "forbidden";
  return null;
}
