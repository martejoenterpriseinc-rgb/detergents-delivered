import { describe, expect, it } from "vitest";
import {
  DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
  parseSeedFlag,
  resolveBootstrapPassword,
  shouldSeedBootstrapAdmin,
} from "./bootstrap-admin";

describe("bootstrap admin seed decision", () => {
  it("never seeds production", () => {
    expect(
      shouldSeedBootstrapAdmin({
        appEnv: "production",
        seedBootstrapAdmin: true,
        hasExistingAdmin: false,
      }),
    ).toBe(false);
  });

  it("seeds when SEED_BOOTSTRAP_ADMIN=true in staging or development", () => {
    expect(
      shouldSeedBootstrapAdmin({
        appEnv: "staging",
        seedBootstrapAdmin: true,
        hasExistingAdmin: true,
      }),
    ).toBe(true);
    expect(
      shouldSeedBootstrapAdmin({
        appEnv: "development",
        seedBootstrapAdmin: true,
        hasExistingAdmin: true,
      }),
    ).toBe(true);
  });

  it("auto-seeds staging and development when no admin exists", () => {
    expect(
      shouldSeedBootstrapAdmin({
        appEnv: "staging",
        seedBootstrapAdmin: false,
        hasExistingAdmin: false,
      }),
    ).toBe(true);
    expect(
      shouldSeedBootstrapAdmin({
        appEnv: "development",
        seedBootstrapAdmin: false,
        hasExistingAdmin: false,
      }),
    ).toBe(true);
  });

  it("skips auto-seed when an admin already exists", () => {
    expect(
      shouldSeedBootstrapAdmin({
        appEnv: "staging",
        seedBootstrapAdmin: false,
        hasExistingAdmin: true,
      }),
    ).toBe(false);
  });

  it("resolves password from env or the documented staging default", () => {
    expect(resolveBootstrapPassword("  Env-Temp-Pass!  ")).toEqual({
      password: "Env-Temp-Pass!",
      source: "env",
    });
    expect(resolveBootstrapPassword(undefined)).toEqual({
      password: DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
      source: "documented-default",
    });
    expect(parseSeedFlag("true")).toBe(true);
    expect(parseSeedFlag("false")).toBe(false);
  });
});
