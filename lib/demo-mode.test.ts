import { afterEach, describe, expect, it } from "vitest";
import {
  canSeedDemoCatalog,
  isDemoModeEnabled,
  shouldSeedDemoCatalogOnBoot,
} from "./demo-mode";

const original = { ...process.env };

afterEach(() => {
  process.env.APP_ENV = original.APP_ENV;
  process.env.DEMO_MODE = original.DEMO_MODE;
  process.env.SEED_DEMO_CATALOG = original.SEED_DEMO_CATALOG;
});

describe("demo mode flags", () => {
  it("never seeds in production", () => {
    process.env.APP_ENV = "production";
    process.env.DEMO_MODE = "true";
    process.env.SEED_DEMO_CATALOG = "true";
    expect(canSeedDemoCatalog()).toBe(false);
    expect(shouldSeedDemoCatalogOnBoot(0)).toBe(false);
  });

  it("seeds an empty catalog in non-production when DEMO_MODE is on", () => {
    process.env.APP_ENV = "staging";
    process.env.DEMO_MODE = "true";
    process.env.SEED_DEMO_CATALOG = "false";
    expect(isDemoModeEnabled()).toBe(true);
    expect(canSeedDemoCatalog()).toBe(true);
    expect(shouldSeedDemoCatalogOnBoot(0)).toBe(true);
    expect(shouldSeedDemoCatalogOnBoot(3)).toBe(false);
  });

  it("treats SEED_DEMO_CATALOG as a seed request", () => {
    process.env.APP_ENV = "development";
    process.env.DEMO_MODE = "false";
    process.env.SEED_DEMO_CATALOG = "true";
    expect(canSeedDemoCatalog()).toBe(true);
  });
});
