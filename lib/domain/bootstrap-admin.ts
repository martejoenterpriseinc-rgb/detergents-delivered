import { BOOTSTRAP_ADMIN_EMAIL, DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD } from "./credentials";

export { BOOTSTRAP_ADMIN_EMAIL, DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD };

export const BOOTSTRAP_ADMIN_NAME = "Bootstrap Super Admin";

export function parseSeedFlag(value: string | undefined): boolean {
  return value === "true";
}

export function resolveBootstrapPassword(envPassword: string | undefined): {
  password: string;
  source: "env" | "documented-default";
} {
  const trimmed = envPassword?.trim();
  if (trimmed) {
    return { password: trimmed, source: "env" };
  }
  return {
    password: DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
    source: "documented-default",
  };
}

/**
 * Seed the bootstrap SUPER_ADMIN when explicitly requested, or automatically
 * in development/staging when no ADMIN / SUPER_ADMIN exists.
 * Production is never seeded this way.
 */
export function shouldSeedBootstrapAdmin(input: {
  appEnv: string;
  seedBootstrapAdmin: boolean;
  hasExistingAdmin: boolean;
}): boolean {
  if (input.appEnv === "production") {
    return false;
  }
  if (input.seedBootstrapAdmin) {
    return true;
  }
  return (
    (input.appEnv === "development" || input.appEnv === "staging") &&
    !input.hasExistingAdmin
  );
}
