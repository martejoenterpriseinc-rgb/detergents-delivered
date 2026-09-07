import { getAppEnv, isProduction } from "@/lib/env";

export function isDemoModeEnabled() {
  return process.env.DEMO_MODE === "true";
}

export function isDemoCatalogSeedRequested() {
  return process.env.SEED_DEMO_CATALOG === "true" || isDemoModeEnabled();
}

/** Never auto-seed or invent catalog data in production. */
export function canSeedDemoCatalog() {
  return !isProduction() && isDemoCatalogSeedRequested();
}

export function shouldSeedDemoCatalogOnBoot(visibleProductCount: number) {
  return (
    canSeedDemoCatalog() && visibleProductCount === 0 && getAppEnv() !== "production"
  );
}
