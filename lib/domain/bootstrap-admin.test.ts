import { describe, expect, it } from "vitest";
import {
  DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
  parseSeedFlag,
  resolveBootstrapPassword,
  shouldSeedBootstrapAdmin,
} from "./bootstrap-admin";
describe("explicit one-time bootstrap", () => {
  it.each(["production", "invalid", ""])("never bootstraps environment %s", (appEnv) => {
    expect(
      shouldSeedBootstrapAdmin({
        appEnv,
        seedBootstrapAdmin: true,
        hasExistingAdmin: false,
      }),
    ).toBe(false);
  });
  it.each(["staging", "development"])(
    "requires opt-in and no administrator in %s",
    (appEnv) => {
      expect(
        shouldSeedBootstrapAdmin({
          appEnv,
          seedBootstrapAdmin: false,
          hasExistingAdmin: false,
        }),
      ).toBe(false);
      expect(
        shouldSeedBootstrapAdmin({
          appEnv,
          seedBootstrapAdmin: true,
          hasExistingAdmin: true,
        }),
      ).toBe(false);
      expect(
        shouldSeedBootstrapAdmin({
          appEnv,
          seedBootstrapAdmin: true,
          hasExistingAdmin: false,
        }),
      ).toBe(true);
    },
  );
  it.each([
    undefined,
    "",
    "short",
    DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
    "x".repeat(73),
    "🔐".repeat(20),
  ])("rejects missing, public or invalid passwords %#", (password) => {
    expect(() => resolveBootstrapPassword(password)).toThrow(
      /SEED_BOOTSTRAP_ADMIN_PASSWORD/,
    );
  });
  it("requires a supplied password and an explicit true flag", () => {
    expect(resolveBootstrapPassword("Synthetic-Setup-Password-123")).toEqual({
      password: "Synthetic-Setup-Password-123",
      source: "env",
    });
    expect(parseSeedFlag("true")).toBe(true);
    expect(parseSeedFlag(undefined)).toBe(false);
    expect(parseSeedFlag("false")).toBe(false);
  });
});
