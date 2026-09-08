import {
  BOOTSTRAP_ADMIN_EMAIL,
  DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
} from "./credentials";

export { BOOTSTRAP_ADMIN_EMAIL, DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD };

export const BOOTSTRAP_ADMIN_NAME = "Bootstrap Super Admin";

export function parseSeedFlag(value: string | undefined): boolean {
  return value === "true";
}

export function resolveBootstrapPassword(envPassword: string | undefined): {
  password: string;
  source: "env";
} {
  const trimmed = envPassword?.trim();
  if (
    !trimmed ||
    trimmed.length < 20 ||
    new TextEncoder().encode(trimmed).length > 72 ||
    trimmed === DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD
  ) {
    throw new Error(
      "Set a unique SEED_BOOTSTRAP_ADMIN_PASSWORD of 20–72 UTF-8 bytes through secure environment entry. Public defaults are forbidden.",
    );
  }
  return { password: trimmed, source: "env" };
}

/**
 * Explicit, one-time setup only; never recreate an administrator after rotation.
 */
export function shouldSeedBootstrapAdmin(input: {
  appEnv: string;
  seedBootstrapAdmin: boolean;
  hasExistingAdmin: boolean;
}): boolean {
  return (
    (input.appEnv === "development" || input.appEnv === "staging") &&
    input.seedBootstrapAdmin &&
    !input.hasExistingAdmin
  );
}
